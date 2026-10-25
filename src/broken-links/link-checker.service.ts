import { Injectable } from '@nestjs/common';
import {
  GuardedHttpResponse,
  GuardedHttpService,
  HttpRequestError,
} from './guarded-http.service';
import { SsrfGuardService, UnsafeUrlError } from './ssrf-guard.service';
import {
  CheckCategory,
  IssueType,
  LinkCheckResult,
  RedirectHop,
  REQUEST_TIMEOUT_MS,
} from './types';

export interface LinkCheckOptions {
  treatRedirectsAsIssues: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class CheckCancelledError extends Error {
  readonly code = 'ERR_CANCELED';

  constructor() {
    super('Link check cancelled.');
    this.name = 'CheckCancelledError';
  }
}

interface AttemptResult {
  response?: GuardedHttpResponse;
  error?: unknown;
  attempts: number;
}

const MAX_GET_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 3000;
const MAX_RETRY_AFTER_MS = 5000;

@Injectable()
export class LinkCheckerService {
  constructor(
    private readonly http: GuardedHttpService,
    private readonly ssrfGuard: SsrfGuardService,
  ) {}

  async check(
    destinationUrl: string,
    options: LinkCheckOptions,
  ): Promise<LinkCheckResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    let attempts = 0;
    let method: 'HEAD' | 'GET' = 'HEAD';
    let redirectChain: RedirectHop[] = [];

    try {
      await this.ssrfGuard.assertSafeUrl(destinationUrl);

      const head = await this.performAttempts(
        'HEAD',
        destinationUrl,
        options,
        1,
        timeoutMs,
      );
      attempts = head.attempts;

      if (head.error) {
        if (!this.canFallbackToGet(head.error)) {
          return this.classifyError(
            destinationUrl,
            head.error,
            'HEAD',
            attempts,
            redirectChain,
            startedAt,
          );
        }
        method = 'GET';
        const get = await this.performAttempts(
          'GET',
          destinationUrl,
          options,
          MAX_GET_ATTEMPTS,
          timeoutMs,
        );
        attempts += get.attempts;
        if (!get.response) {
          return this.classifyError(
            destinationUrl,
            get.error,
            'GET',
            attempts,
            redirectChain,
            startedAt,
          );
        }
        return this.evaluateResponse(
          destinationUrl,
          get.response,
          options.treatRedirectsAsIssues,
          attempts,
          startedAt,
          'GET',
        );
      }

      const headResponse = head.response;
      if (!headResponse) {
        return this.classifyError(
          destinationUrl,
          new Error('No response received.'),
          'HEAD',
          attempts,
          redirectChain,
          startedAt,
        );
      }
      redirectChain = headResponse.redirectChain;

      if (this.shouldFallbackFromHead(headResponse.status)) {
        method = 'GET';
        const get = await this.performAttempts(
          'GET',
          destinationUrl,
          options,
          MAX_GET_ATTEMPTS,
          timeoutMs,
        );
        attempts += get.attempts;
        if (!get.response) {
          return this.classifyError(
            destinationUrl,
            get.error,
            'GET',
            attempts,
            redirectChain,
            startedAt,
          );
        }
        return this.evaluateResponse(
          destinationUrl,
          get.response,
          options.treatRedirectsAsIssues,
          attempts,
          startedAt,
          'GET',
        );
      }

      return this.evaluateResponse(
        destinationUrl,
        headResponse,
        options.treatRedirectsAsIssues,
        attempts,
        startedAt,
        method,
      );
    } catch (error) {
      if (isCancellationError(error) || options.signal?.aborted) {
        throw error;
      }
      return this.classifyError(
        destinationUrl,
        error,
        method,
        attempts,
        redirectChain,
        startedAt,
      );
    }
  }

  evaluateResponse(
    destinationUrl: string,
    response: GuardedHttpResponse,
    treatRedirectsAsIssues: boolean,
    attempts: number,
    startedAt: number,
    method: 'HEAD' | 'GET',
  ): LinkCheckResult {
    const status = response.status;
    const hasRedirect = response.redirectChain.length > 0;
    let category: CheckCategory;
    let issueType: IssueType;
    let isBroken = false;
    let error: string | null = null;

    if (status >= 200 && status < 300) {
      if (hasRedirect) {
        category = 'redirect';
        issueType = 'redirect';
        isBroken = treatRedirectsAsIssues;
        error = null;
      } else {
        category = 'healthy';
        issueType = 'none';
      }
    } else if (status === 404) {
      category = 'broken';
      issueType = 'not_found';
      isBroken = true;
      error = 'Destination returned HTTP 404 (Not Found).';
    } else if (status === 410) {
      category = 'broken';
      issueType = 'gone';
      isBroken = true;
      error = 'Destination returned HTTP 410 (Permanently Gone).';
    } else if (status === 401 || status === 403) {
      category = 'restricted';
      issueType = 'access_restricted';
      error = `Destination returned HTTP ${status} (Access Restricted).`;
    } else if (status === 429) {
      category = 'unverified';
      issueType = 'rate_limited';
      error = 'Destination returned HTTP 429 (Rate Limited).';
    } else if (status >= 500 && status < 600) {
      category = 'server_error';
      issueType = 'server_error';
      isBroken = true;
      error = `Destination returned HTTP ${status} (Server Error).`;
    } else if (status >= 400 && status < 500) {
      category = 'broken';
      issueType = 'client_error';
      isBroken = true;
      error = `Destination returned HTTP ${status} (Client Error).`;
    } else if (status >= 300 && status < 400) {
      category = 'redirect';
      issueType = 'redirect';
      isBroken = treatRedirectsAsIssues;
      error = hasRedirect
        ? null
        : `Destination returned HTTP ${status} without a usable redirect location.`;
    } else {
      category = 'unverified';
      issueType = 'unsupported';
      error = `Destination returned an unsupported HTTP status (${status}).`;
    }

    return {
      destinationUrl,
      method,
      status,
      category,
      issueType,
      isBroken,
      finalUrl: response.finalUrl,
      redirectChain: response.redirectChain,
      error,
      attempts,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }

  private async performAttempts(
    method: 'HEAD' | 'GET',
    url: string,
    options: LinkCheckOptions,
    maxAttempts: number,
    timeoutMs: number,
  ): Promise<AttemptResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.throwIfCancelled(options.signal);
      try {
        const response = await this.http.request(url, {
          method,
          readBody: false,
          timeoutMs,
          signal: options.signal,
        });

        const transient = response.status === 429 || response.status >= 500;
        if (transient && attempt < maxAttempts) {
          const delayMs =
            this.retryAfterMs(response.headers) ?? this.backoffMs(attempt);
          await this.delay(delayMs, options.signal);
          continue;
        }

        return { response, attempts: attempt };
      } catch (error) {
        if (isCancellationError(error) || options.signal?.aborted) {
          throw error;
        }
        if (this.isNonRetryable(error)) {
          return { error, attempts: attempt };
        }
        lastError = error;
        if (attempt < maxAttempts) {
          await this.delay(this.backoffMs(attempt), options.signal);
        }
      }
    }

    return { error: lastError, attempts: maxAttempts };
  }

  private classifyError(
    destinationUrl: string,
    error: unknown,
    method: 'HEAD' | 'GET' | null,
    attempts: number,
    redirectChain: RedirectHop[],
    startedAt: number,
  ): LinkCheckResult {
    let code = '';
    let message =
      error instanceof Error ? error.message : 'The link check failed.';

    if (error instanceof UnsafeUrlError) {
      code = error.code;
    } else {
      const candidate = error as {
        code?: unknown;
        name?: unknown;
        message?: unknown;
      };
      if (typeof candidate?.code === 'string') code = candidate.code;
      if (typeof candidate?.message === 'string') message = candidate.message;
    }

    if (error instanceof HttpRequestError) {
      redirectChain = error.redirectChain;
      if (error.code === 'redirect_loop') {
        return this.buildErrorResult(
          destinationUrl,
          method,
          'broken',
          'redirect_loop',
          true,
          error.message,
          redirectChain,
          attempts,
          startedAt,
        );
      }
      if (error.code === 'too_many_redirects') {
        return this.buildErrorResult(
          destinationUrl,
          method,
          'broken',
          'too_many_redirects',
          true,
          error.message,
          redirectChain,
          attempts,
          startedAt,
        );
      }
    }

    if (code === 'redirect_loop') {
      return this.buildErrorResult(
        destinationUrl,
        method,
        'broken',
        'redirect_loop',
        true,
        message,
        redirectChain,
        attempts,
        startedAt,
      );
    }
    if (code === 'too_many_redirects' || code === 'ERR_FR_TOO_MANY_REDIRECTS') {
      return this.buildErrorResult(
        destinationUrl,
        method,
        'broken',
        'too_many_redirects',
        true,
        message,
        redirectChain,
        attempts,
        startedAt,
      );
    }

    if (error instanceof UnsafeUrlError) {
      if (error.code === 'invalid_url') {
        return this.buildErrorResult(
          destinationUrl,
          method,
          'unverified',
          'invalid_url',
          false,
          message,
          redirectChain,
          attempts,
          startedAt,
        );
      }
      return this.buildErrorResult(
        destinationUrl,
        method,
        'unverified',
        'blocked',
        false,
        message,
        redirectChain,
        attempts,
        startedAt,
      );
    }

    if (
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT' ||
      code === 'ESOCKETTIMEDOUT'
    ) {
      return this.buildErrorResult(
        destinationUrl,
        method,
        'unverified',
        'timeout',
        false,
        `The request timed out${message ? `: ${message}` : '.'}`,
        redirectChain,
        attempts,
        startedAt,
      );
    }

    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return this.buildErrorResult(
        destinationUrl,
        method,
        'unverified',
        'dns_error',
        false,
        `DNS resolution failed${message ? `: ${message}` : '.'}`,
        redirectChain,
        attempts,
        startedAt,
      );
    }

    if (
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'EHOSTUNREACH' ||
      code === 'ENETUNREACH' ||
      code === 'EPIPE'
    ) {
      return this.buildErrorResult(
        destinationUrl,
        method,
        'unverified',
        'connection_error',
        false,
        `Connection failed${message ? `: ${message}` : '.'}`,
        redirectChain,
        attempts,
        startedAt,
      );
    }

    if (this.isTlsError(code, message)) {
      return this.buildErrorResult(
        destinationUrl,
        method,
        'unverified',
        'tls_error',
        false,
        `TLS error${message ? `: ${message}` : '.'}`,
        redirectChain,
        attempts,
        startedAt,
      );
    }

    return this.buildErrorResult(
      destinationUrl,
      method,
      'unverified',
      'other_error',
      false,
      message || 'The link check could not be completed.',
      redirectChain,
      attempts,
      startedAt,
    );
  }

  private buildErrorResult(
    destinationUrl: string,
    method: 'HEAD' | 'GET' | null,
    category: CheckCategory,
    issueType: IssueType,
    isBroken: boolean,
    error: string,
    redirectChain: RedirectHop[],
    attempts: number,
    startedAt: number,
  ): LinkCheckResult {
    return {
      destinationUrl,
      method,
      status: null,
      category,
      issueType,
      isBroken,
      finalUrl: redirectChain.length
        ? (redirectChain[redirectChain.length - 1].location ?? null)
        : null,
      redirectChain,
      error,
      attempts,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }

  private shouldFallbackFromHead(status: number): boolean {
    return (
      status === 0 ||
      status === 400 ||
      status === 401 ||
      status === 403 ||
      status === 405 ||
      status === 406 ||
      status === 429 ||
      status === 501 ||
      status >= 500
    );
  }

  private canFallbackToGet(error: unknown): boolean {
    if (error instanceof UnsafeUrlError) return false;
    return !isCancellationError(error);
  }

  private isNonRetryable(error: unknown): boolean {
    if (error instanceof UnsafeUrlError) return true;
    if (error instanceof HttpRequestError) {
      return (
        error.code === 'redirect_loop' ||
        error.code === 'too_many_redirects' ||
        error.code === 'invalid_redirect'
      );
    }
    return false;
  }

  private isTlsError(code: string, message: string): boolean {
    const normalized = `${code} ${message}`.toUpperCase();
    return (
      code.startsWith('ERR_TLS') ||
      code.startsWith('ERR_SSL') ||
      code.startsWith('CERT_') ||
      normalized.includes('CERTIFICATE') ||
      normalized.includes('SELF_SIGNED') ||
      normalized.includes('ALTNAME')
    );
  }

  private retryAfterMs(
    headers: Record<string, string | string[] | undefined>,
  ): number | null {
    const raw = headers['retry-after'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;

    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.min(seconds * 1000, MAX_RETRY_AFTER_MS));
    }

    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return Math.max(0, Math.min(timestamp - Date.now(), MAX_RETRY_AFTER_MS));
    }
    return null;
  }

  private backoffMs(attempt: number): number {
    return Math.min(
      BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1),
      MAX_RETRY_DELAY_MS,
    );
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      this.throwIfCancelled(signal);
      if (ms <= 0) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new CheckCancelledError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new CheckCancelledError();
    }
  }
}

export function isCancellationError(error: unknown): boolean {
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    candidate?.code === 'ERR_CANCELED' ||
    candidate?.name === 'CanceledError' ||
    candidate?.name === 'AbortError' ||
    candidate?.name === 'CheckCancelledError'
  );
}
