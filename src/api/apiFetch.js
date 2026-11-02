// Shared HTTP client for signed-in requests. Never log the access token.
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class ApiAuthError extends ApiError {
  constructor(message = 'Please sign in again to continue.') {
    super(message, 401);
    this.name = 'ApiAuthError';
  }
}

export class ApiNetworkError extends ApiError {
  constructor() {
    super('Could not reach the game server.');
    this.name = 'ApiNetworkError';
  }
}

export function createApiFetch({ baseUrl, getAccessToken, login, fetchImpl = globalThis.fetch }) {
  let signInPromise = null;

  return async function apiFetch(path, options = {}) {
    if (!baseUrl) throw new ApiError('The game server is not configured.');

    const base = new URL(baseUrl);
    const url = new URL(path, base);
    // A token for our API must never be attached to another server's URL.
    if (!['http:', 'https:'].includes(base.protocol) || url.origin !== base.origin) {
      throw new ApiError('The API request address is invalid.');
    }

    options.signal?.throwIfAborted();
    const token = await getAccessToken();
    options.signal?.throwIfAborted();
    // MSAL may already be navigating to Microsoft to renew the session.
    // Do not make an anonymous request or start another redirect here.
    if (!token) throw new ApiAuthError();

    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);

    let response;
    try {
      response = await fetchImpl(url.toString(), { ...options, headers });
    } catch (error) {
      if (error.name === 'AbortError' || options.signal?.aborted) throw error;
      if (error instanceof TypeError) throw new ApiNetworkError();
      throw error;
    }

    if (response.status === 401) {
      // A rejected POST is never retried automatically: that could create two
      // sessions. Concurrent 401s share a single sign-in attempt instead.
      if (!signInPromise) {
        signInPromise = Promise.resolve().then(login).finally(() => {
          signInPromise = null;
        });
      }
      try {
        await signInPromise;
      } catch {
        throw new ApiAuthError('Your session expired. Please use Sign in to try again.');
      }
      throw new ApiAuthError('Your session expired. Please sign in again.');
    }

    if (!response.ok) {
      const message = response.status === 403
        ? 'Your account does not have permission to access this session.'
        : `The game server returned an error (HTTP ${response.status}).`;
      throw new ApiError(message, response.status);
    }
    return response;
  };
}
