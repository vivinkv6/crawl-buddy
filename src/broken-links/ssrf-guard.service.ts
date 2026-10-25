import { Injectable } from '@nestjs/common';
import * as dns from 'node:dns';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

export type UnsafeUrlCode = 'invalid_url' | 'blocked_host' | 'dns_error';

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    public readonly code: UnsafeUrlCode,
  ) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.localdomain',
];

const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

@Injectable()
export class SsrfGuardService {
  async assertSafeUrl(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new UnsafeUrlError('Invalid URL format.', 'invalid_url');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new UnsafeUrlError(
        'Only HTTP and HTTPS URLs are supported.',
        'invalid_url',
      );
    }

    const hostname = this.normalizeHostname(url.hostname);
    if (this.isBlockedHostname(hostname)) {
      throw new UnsafeUrlError(
        `Requests to "${hostname}" are not allowed.`,
        'blocked_host',
      );
    }

    const literalIp = this.unbracket(hostname);
    if (isIP(literalIp) !== 0) {
      if (!this.isPublicIp(literalIp)) {
        throw new UnsafeUrlError(
          `Requests to the IP address "${literalIp}" are not allowed.`,
          'blocked_host',
        );
      }
      return url;
    }

    let addresses: dns.LookupAddress[];
    try {
      addresses = await dns.promises.lookup(hostname, {
        all: true,
        verbatim: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'DNS resolution failed.';
      throw new UnsafeUrlError(
        `Unable to resolve "${hostname}": ${message}`,
        'dns_error',
      );
    }

    if (addresses.length === 0) {
      throw new UnsafeUrlError(`Unable to resolve "${hostname}".`, 'dns_error');
    }

    const blocked = addresses.find(
      (address) => !this.isPublicIp(address.address),
    );
    if (blocked) {
      throw new UnsafeUrlError(
        `"${hostname}" resolves to a private or reserved address (${blocked.address}).`,
        'blocked_host',
      );
    }

    return url;
  }

  isPublicIp(rawIp: string): boolean {
    const ip = rawIp.split('%')[0].trim().toLowerCase();
    const version = isIP(ip);
    if (version === 4) return this.isPublicIpv4(ip);
    if (version === 6) return this.isPublicIpv6(ip);
    return false;
  }

  createGuardedLookup(): LookupFunction {
    return (hostname, options, callback) => {
      dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) {
          callback(error, [], 0);
          return;
        }

        const list = Array.isArray(addresses) ? addresses : [];
        if (list.length === 0) {
          const notFound = new Error(
            `Unable to resolve "${hostname}".`,
          ) as NodeJS.ErrnoException;
          notFound.code = 'ENOTFOUND';
          callback(notFound, [], 0);
          return;
        }

        const blocked = list.find(
          (address) => !this.isPublicIp(address.address),
        );
        if (blocked) {
          callback(
            new UnsafeUrlError(
              `"${hostname}" resolves to a private or reserved address (${blocked.address}).`,
              'blocked_host',
            ),
            [],
            0,
          );
          return;
        }

        const wantsAll = Boolean(
          (options as dns.LookupOptions | undefined)?.all,
        );
        if (wantsAll) {
          callback(null, list, 0);
        } else {
          callback(null, list[0].address, list[0].family);
        }
      });
    };
  }

  private normalizeHostname(hostname: string): string {
    return this.unbracket(hostname).toLowerCase().replace(/\.$/, '');
  }

  private unbracket(hostname: string): string {
    return hostname.replace(/^\[/, '').replace(/\]$/, '');
  }

  private isBlockedHostname(hostname: string): boolean {
    if (BLOCKED_HOSTNAMES.has(hostname)) return true;
    return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) =>
      hostname.endsWith(suffix),
    );
  }

  private isPublicIpv4(ip: string): boolean {
    const value = this.ipv4ToNumber(ip);
    if (value === null) return false;
    return !IPV4_BLOCKED_RANGES.some(([base, bits]) => {
      const baseValue = this.ipv4ToNumber(base);
      if (baseValue === null) return false;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
    });
  }

  private ipv4ToNumber(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) return null;
      const octet = Number(part);
      if (octet > 255) return null;
      value = ((value << 8) | octet) >>> 0;
    }
    return value >>> 0;
  }

  private isPublicIpv6(ip: string): boolean {
    const mapped = this.extractMappedIpv4(ip);
    if (mapped) return this.isPublicIpv4(mapped);

    if (ip === '::' || ip === '::1') return false;

    const firstHextet = Number.parseInt(ip.split(':')[0] || '0', 16);
    // Only global unicast (2000::/3) is allowed.
    if (
      !Number.isFinite(firstHextet) ||
      firstHextet < 0x2000 ||
      firstHextet > 0x3fff
    ) {
      return false;
    }

    if (
      ip.startsWith('2001:db8') ||
      ip.startsWith('2001:0:') ||
      ip.startsWith('2002:') ||
      ip.startsWith('64:ff9b')
    ) {
      return false;
    }

    return true;
  }

  private extractMappedIpv4(ip: string): string | null {
    const mapped = ip.match(/^::ffff:(.+)$/i);
    if (mapped) {
      const tail = mapped[1];
      if (tail.includes('.')) return tail;
      const parts = tail.split(':');
      if (parts.length === 2) {
        const high = Number.parseInt(parts[0], 16);
        const low = Number.parseInt(parts[1], 16);
        if (Number.isFinite(high) && Number.isFinite(low)) {
          return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
        }
      }
    }

    if (ip.startsWith('::') && ip.includes('.')) {
      return ip.slice(2);
    }
    return null;
  }
}
