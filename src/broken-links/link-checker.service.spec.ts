import {
  GuardedHttpResponse,
  GuardedHttpService,
  HttpRequestError,
} from './guarded-http.service';
import {
  CheckCancelledError,
  LinkCheckerService,
} from './link-checker.service';
import { SsrfGuardService, UnsafeUrlError } from './ssrf-guard.service';
import { RedirectHop } from './types';

const DESTINATION = 'https://example.com/page';

function buildResponse(
  status: number,
  method: 'HEAD' | 'GET' = 'HEAD',
  redirectChain: RedirectHop[] = [],
  headers: Record<string, string | string[] | undefined> = {},
): GuardedHttpResponse {
  return {
    requestedUrl: DESTINATION,
    finalUrl: DESTINATION,
    status,
    method,
    headers,
    body: null,
    redirectChain,
  };
}

describe('LinkCheckerService', () => {
  let checker: LinkCheckerService;
  let http: { request: jest.Mock };
  let guard: { assertSafeUrl: jest.Mock };

  beforeEach(() => {
    http = { request: jest.fn() };
    guard = {
      assertSafeUrl: jest.fn().mockResolvedValue(new URL(DESTINATION)),
    };
    checker = new LinkCheckerService(
      http as unknown as GuardedHttpService,
      guard as unknown as SsrfGuardService,
    );
    jest
      .spyOn(
        checker as unknown as {
          delay: (ms: number, signal?: AbortSignal) => Promise<void>;
        },
        'delay',
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('classifies a 2xx HEAD response as healthy', async () => {
    http.request.mockResolvedValue(buildResponse(200));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('healthy');
    expect(result.issueType).toBe('none');
    expect(result.isBroken).toBe(false);
    expect(result.method).toBe('HEAD');
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('classifies 404 as a broken link without falling back to GET', async () => {
    http.request.mockResolvedValue(buildResponse(404));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('broken');
    expect(result.issueType).toBe('not_found');
    expect(result.isBroken).toBe(true);
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('classifies 410 as permanently gone', async () => {
    http.request.mockResolvedValue(buildResponse(410));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.issueType).toBe('gone');
    expect(result.isBroken).toBe(true);
  });

  it('classifies a persistent 5xx response as a server error', async () => {
    http.request
      .mockResolvedValueOnce(buildResponse(500, 'HEAD'))
      .mockResolvedValueOnce(buildResponse(500, 'GET'))
      .mockResolvedValueOnce(buildResponse(500, 'GET'))
      .mockResolvedValueOnce(buildResponse(500, 'GET'));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('server_error');
    expect(result.issueType).toBe('server_error');
    expect(result.isBroken).toBe(true);
    expect(result.attempts).toBe(4);
    expect(http.request).toHaveBeenCalledTimes(4);
  });

  it('falls back to GET when HEAD returns 405', async () => {
    http.request
      .mockResolvedValueOnce(buildResponse(405, 'HEAD'))
      .mockResolvedValueOnce(buildResponse(200, 'GET'));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('healthy');
    expect(result.method).toBe('GET');
    expect(http.request).toHaveBeenCalledTimes(2);
    const calls = http.request.mock.calls as Array<
      [string, { method?: string }]
    >;
    expect(calls[1][1].method).toBe('GET');
  });

  it('falls back to GET for HEAD 403 and keeps restricted responses distinct', async () => {
    http.request
      .mockResolvedValueOnce(buildResponse(403, 'HEAD'))
      .mockResolvedValueOnce(buildResponse(403, 'GET'));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('restricted');
    expect(result.issueType).toBe('access_restricted');
    expect(result.isBroken).toBe(false);
  });

  it('classifies redirects without treating them as broken by default', async () => {
    const redirects: RedirectHop[] = [
      {
        url: DESTINATION,
        status: 301,
        location: 'https://example.com/new',
      },
    ];
    http.request.mockResolvedValue(buildResponse(200, 'HEAD', redirects));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('redirect');
    expect(result.issueType).toBe('redirect');
    expect(result.isBroken).toBe(false);
    expect(result.redirectChain).toHaveLength(1);
  });

  it('treats redirects as broken when configured to do so', async () => {
    const redirects: RedirectHop[] = [
      {
        url: DESTINATION,
        status: 302,
        location: 'https://example.com/new',
      },
    ];
    http.request.mockResolvedValue(buildResponse(200, 'HEAD', redirects));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: true,
    });

    expect(result.category).toBe('redirect');
    expect(result.isBroken).toBe(true);
  });

  it('detects redirect loops', async () => {
    const redirects: RedirectHop[] = [
      { url: DESTINATION, status: 301, location: DESTINATION },
    ];
    http.request.mockRejectedValue(
      new HttpRequestError(
        'Redirect loop detected.',
        'redirect_loop',
        redirects,
      ),
    );

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('broken');
    expect(result.issueType).toBe('redirect_loop');
    expect(result.isBroken).toBe(true);
    expect(result.redirectChain).toHaveLength(1);
  });

  it('classifies timeouts as unverified', async () => {
    const timeoutError = Object.assign(
      new Error('timeout of 10000ms exceeded'),
      {
        code: 'ECONNABORTED',
      },
    );
    http.request.mockRejectedValue(timeoutError);

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('unverified');
    expect(result.issueType).toBe('timeout');
    expect(result.isBroken).toBe(false);
  });

  it('falls back to GET after a HEAD network failure', async () => {
    const networkError = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });
    http.request
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(buildResponse(200, 'GET'));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('healthy');
    expect(result.method).toBe('GET');
    expect(result.attempts).toBe(2);
  });

  it('respects Retry-After for 429 responses', async () => {
    http.request
      .mockResolvedValueOnce(buildResponse(429, 'HEAD'))
      .mockResolvedValueOnce(
        buildResponse(429, 'GET', [], { 'retry-after': '0' }),
      )
      .mockResolvedValueOnce(
        buildResponse(429, 'GET', [], { 'retry-after': '0' }),
      )
      .mockResolvedValueOnce(buildResponse(200, 'GET'));

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('healthy');
    expect(http.request).toHaveBeenCalledTimes(4);
  });

  it('does not request private destinations blocked by the SSRF guard', async () => {
    guard.assertSafeUrl.mockRejectedValue(
      new UnsafeUrlError('Blocked private address.', 'blocked_host'),
    );

    const result = await checker.check(DESTINATION, {
      treatRedirectsAsIssues: false,
    });

    expect(result.category).toBe('unverified');
    expect(result.issueType).toBe('blocked');
    expect(result.isBroken).toBe(false);
    expect(http.request).not.toHaveBeenCalled();
  });

  it('throws when the audit is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    guard.assertSafeUrl.mockResolvedValue(new URL(DESTINATION));

    await expect(
      checker.check(DESTINATION, {
        treatRedirectsAsIssues: false,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(CheckCancelledError);
    expect(http.request).not.toHaveBeenCalled();
  });
});
