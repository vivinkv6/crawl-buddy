import * as dns from 'node:dns';
import { SsrfGuardService, UnsafeUrlError } from './ssrf-guard.service';

describe('SsrfGuardService', () => {
  const guard = new SsrfGuardService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isPublicIp', () => {
    it('rejects private, loopback, link-local, and reserved IPv4 ranges', () => {
      for (const ip of [
        '127.0.0.1',
        '10.1.2.3',
        '172.16.5.4',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '224.0.0.1',
      ]) {
        expect(guard.isPublicIp(ip)).toBe(false);
      }
    });

    it('allows public IPv4 addresses', () => {
      expect(guard.isPublicIp('8.8.8.8')).toBe(true);
      expect(guard.isPublicIp('93.184.216.34')).toBe(true);
    });

    it('rejects private and reserved IPv6 addresses', () => {
      for (const ip of [
        '::1',
        '::',
        'fc00::1',
        'fd12:3456::1',
        'fe80::1',
        'ff02::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '2001:db8::1',
        '2002:7f00:1::1',
      ]) {
        expect(guard.isPublicIp(ip)).toBe(false);
      }
    });

    it('allows public IPv6 addresses', () => {
      expect(guard.isPublicIp('2001:4860:4860::8888')).toBe(true);
    });
  });

  describe('assertSafeUrl', () => {
    it('rejects non-HTTP protocols', async () => {
      await expect(
        guard.assertSafeUrl('ftp://example.com'),
      ).rejects.toMatchObject({ code: 'invalid_url' });
    });

    it('rejects localhost and private IP literals', async () => {
      await expect(
        guard.assertSafeUrl('http://localhost/'),
      ).rejects.toMatchObject({ code: 'blocked_host' });
      await expect(
        guard.assertSafeUrl('http://127.0.0.1/'),
      ).rejects.toMatchObject({ code: 'blocked_host' });
      await expect(
        guard.assertSafeUrl('http://169.254.169.254/latest/meta-data/'),
      ).rejects.toMatchObject({ code: 'blocked_host' });
    });

    it('rejects hostnames that resolve to private addresses', async () => {
      jest
        .spyOn(dns.promises, 'lookup')
        .mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);

      await expect(
        guard.assertSafeUrl('https://internal.example/'),
      ).rejects.toMatchObject({ code: 'blocked_host' });
    });

    it('accepts hostnames that resolve only to public addresses', async () => {
      jest
        .spyOn(dns.promises, 'lookup')
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);

      const url = await guard.assertSafeUrl('https://example.com/path');
      expect(url.href).toBe('https://example.com/path');
    });

    it('reports DNS failures', async () => {
      jest
        .spyOn(dns.promises, 'lookup')
        .mockRejectedValue(new Error('ENOTFOUND'));

      await expect(
        guard.assertSafeUrl('https://missing.example/'),
      ).rejects.toBeInstanceOf(UnsafeUrlError);
    });
  });
});
