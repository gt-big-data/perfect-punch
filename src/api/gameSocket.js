import { ApiAuthError, ApiError } from './apiFetch.js';

export function buildGameSocketUrl(baseUrl, sessionId) {
  let url;
  try {
    const base = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
        base.search || base.hash || (base.protocol === 'http:' && !local) || !sessionId) {
      throw new Error();
    }
    url = new URL(`/game/sessions/${encodeURIComponent(sessionId)}/ws`, base);
    url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  } catch {
    throw new ApiError('The game streaming address is invalid. Use HTTPS outside localhost.');
  }
  return url.toString();
}

function closeError(code) {
  if (code === 4401) return new ApiAuthError('Your streaming session expired. Please sign in again.');
  if (code === 4403) return new ApiError('Your account cannot stream this session.', 403);
  return new ApiError('The game connection closed. Please return home and try again.');
}

// Resolves only after the server has validated the token AND session owner.
// The returned send() stays closed before auth_ok and after disconnect.
export async function connectGameSocket({
  baseUrl, sessionId, getAccessToken, signal, onMessage = () => {}, onDisconnect = () => {},
  WebSocketImpl = globalThis.WebSocket, timeoutMs = 12000,
}) {
  const url = buildGameSocketUrl(baseUrl, sessionId);
  signal?.throwIfAborted();
  const token = await getAccessToken();
  signal?.throwIfAborted();
  if (typeof token !== 'string' || !token.trim()) throw new ApiAuthError();

  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(url);
    let authenticated = false;
    let settled = false;
    let stopped = false;
    let timer;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      authenticated = false;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      // Also close a socket that is still connecting.
      if (ws.readyState < 2) ws.close();
    };
    const fail = (error) => {
      if (stopped) return;
      const wasReady = settled;
      stop();
      if (wasReady) onDisconnect(error);
      else { settled = true; reject(error); }
    };
    const abort = () => {
      if (!settled) { settled = true; reject(signal.reason || new DOMException('Aborted', 'AbortError')); }
      stop();
    };
    const connection = {
      send(message) {
        if (!authenticated || stopped || ws.readyState !== 1) return false;
        ws.send(JSON.stringify(message));
        return true;
      },
      close() {
        if (!settled) { settled = true; reject(new DOMException('Aborted', 'AbortError')); }
        stop();
      },
    };

    ws.onopen = () => {
      if (!stopped) ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = (event) => {
      if (stopped) return;
      let message;
      try { message = JSON.parse(event.data); } catch {
        fail(new ApiError('The game server sent an invalid message.'));
        return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        fail(new ApiError('The game server sent an invalid message.'));
        return;
      }
      if (!authenticated) {
        if (message.type !== 'auth_ok' || message.session_id !== sessionId) {
          fail(new ApiAuthError('The game server did not authenticate this session.'));
          return;
        }
        authenticated = true;
        settled = true;
        clearTimeout(timer);
        resolve(connection);
        return;
      }
      onMessage(message);
    };
    ws.onclose = (event) => fail(closeError(event.code));
    ws.onerror = () => fail(new ApiError('Could not open the game connection. Check that the backend is running.'));
    timer = setTimeout(() => fail(new ApiError('The game connection timed out. Please try again.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
