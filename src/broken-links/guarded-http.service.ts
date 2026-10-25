import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as http from 'node:http';
import * as https from 'node:https';
import { normalizeUrl } from './link-url.util';
import { SsrfGuardService } from './ssrf-guard.service';
import {
  MAX_HTML_BYTES,
  MAX_REDIRECTS,
  RedirectHop,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
} from './types';

export type HttpRequestErrorCode =
  | 'redirect_loop'
  | 'too_many_redirects'
  | 'invalid_redirect';

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly code: HttpRequestErrorCode,
    public readonly redirectChain: RedirectHop[] = [],
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export interface GuardedRequestOptions {
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  maxRedirects?: number;
  readBody?: boolean;
  maxBodyBytes?: number;
  signal?: AbortSignal;
}

export interface GuardedHttpResponse {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  method: 'GET' | 'HEAD';
  headers: Record<string, string | string[] | undefined>;
  body: string | null;
  redirectChain: RedirectHop[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

@Injectable()
export class GuardedHttpService {
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor(private readonly ssrfGuard: SsrfGuardService) {
    const lookup = this.ssrfGuard.createGuardedLookup();
    this.httpAgent = new http.Agent({ lookup, keepAlive: false });
    this.httpsAgent = new https.Agent({ lookup, keepAlive: false });
  }

  async request(
    rawUrl: string,
    options: GuardedRequestOptions = {},
  ): Promise<GuardedHttpResponse> {
    const readBody = options.readBody === true;
    const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
    const maxBodyBytes = options.maxBodyBytes ?? MAX_HTML_BYTES;
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    let method: 'GET' | 'HEAD' = options.method ?? 'GET';
    let currentUrl = await this.ssrfGuard.assertSafeUrl(rawUrl);
    const requestedUrl = currentUrl.href;
    const redirectChain: RedirectHop[] = [];
    const seenUrls = new Set<string>();

    const seenKey = (value: string): string => {
      try {
        return normalizeUrl(value);
      } catch {
        return value;
      }
    };
    seenUrls.add(seenKey(currentUrl.href));

    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await axios.request({
        url: currentUrl.href,
        method,
        timeout: timeoutMs,
        maxRedirects: 0,
        validateStatus: () => true,
        responseType: readBody ? 'text' : 'stream',
        responseEncoding: 'utf8',
        maxContentLength: maxBodyBytes,
        maxBodyLength: maxBodyBytes,
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
        proxy: false,
        signal: options.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const location = this.headerValue(response.headers.location);
      if (REDIRECT_STATUSES.has(response.status) && location) {
        this.discardBody(response.data, readBody);

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          throw new HttpRequestError(
            `Invalid redirect location: ${location}`,
            'invalid_redirect',
            [...redirectChain],
          );
        }
        nextUrl.hash = '';

        const nextKey = seenKey(nextUrl.href);
        const hop: RedirectHop = {
          url: currentUrl.href,
          status: response.status,
          location: nextUrl.href,
        };

        if (seenUrls.has(nextKey)) {
          redirectChain.push(hop);
          throw new HttpRequestError(
            'Redirect loop detected.',
            'redirect_loop',
            [...redirectChain],
          );
        }

        if (redirectCount >= maxRedirects) {
          redirectChain.push(hop);
          throw new HttpRequestError(
            `Maximum redirect limit (${maxRedirects}) exceeded.`,
            'too_many_redirects',
            [...redirectChain],
          );
        }

        redirectChain.push(hop);
        seenUrls.add(nextKey);
        currentUrl = await this.ssrfGuard.assertSafeUrl(nextUrl.href);

        if (response.status === 303) {
          method = 'GET';
        }
        continue;
      }

      const body = readBody
        ? typeof response.data === 'string'
          ? response.data
          : null
        : null;
      if (!readBody) {
        this.discardBody(response.data, false);
      }

      return {
        requestedUrl,
        finalUrl: currentUrl.href,
        status: response.status,
        method,
        headers: response.headers as Record<
          string,
          string | string[] | undefined
        >,
        body,
        redirectChain,
      };
    }
  }

  private headerValue(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return null;
  }

  private discardBody(data: unknown, alreadyRead: boolean): void {
    if (alreadyRead || data === null || data === undefined) return;
    const stream = data as {
      destroy?: () => void;
      resume?: () => void;
    };
    if (typeof stream.destroy === 'function') {
      stream.destroy();
    } else if (typeof stream.resume === 'function') {
      stream.resume();
    }
  }
}
