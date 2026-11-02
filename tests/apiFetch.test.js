import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApiFetch, ApiError, ApiAuthError, ApiNetworkError } from '../src/api/apiFetch.js';

const makeClient = (overrides = {}) => createApiFetch({
  baseUrl: 'https://game.example',
  getAccessToken: async () => 'test-token',
  login: async () => {},
  fetchImpl: async () => new Response('{}'),
  ...overrides,
});

test('sends the token and JSON body to an actual local HTTP server', async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received = { token: request.headers.authorization, method: request.method,
      type: request.headers['content-type'], body: JSON.parse(body), url: request.url };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ session_id: 'session-1' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const apiFetch = makeClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, fetchImpl: fetch });
  const response = await apiFetch('/game/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duration_seconds: 30 }),
  });
  assert.equal(received.token, 'Bearer test-token');
  assert.equal(received.method, 'POST');
  assert.equal(received.type, 'application/json');
  assert.equal(received.url, '/game/sessions');
  assert.deepEqual(received.body, { duration_seconds: 30 });
  assert.deepEqual(await response.json(), { session_id: 'session-1' });
});

test('acquires a fresh token for each call and overrides old authorization headers', async () => {
  let tokenNumber = 0;
  const tokens = [];
  const apiFetch = makeClient({
    getAccessToken: async () => `token-${++tokenNumber}`,
    fetchImpl: async (_, options) => { tokens.push(options.headers.get('Authorization')); return new Response('{}'); },
  });
  await apiFetch('/session/latest', { headers: new Headers({ Authorization: 'old' }) });
  await apiFetch('/session/latest');
  assert.deepEqual(tokens, ['Bearer token-1', 'Bearer token-2']);
});

test('preserves the query, cache option and abort signal', async () => {
  const signal = new AbortController().signal;
  const apiFetch = makeClient({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://game.example/session/latest?session_id=a%2Fb');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.signal, signal);
    return new Response('{}');
  } });
  await apiFetch('/session/latest?session_id=a%2Fb', { cache: 'no-store', signal });
});

test('missing token stops the request without starting a second login', async () => {
  const apiFetch = makeClient({
    getAccessToken: async () => null,
    fetchImpl: () => assert.fail('Anonymous request was sent'),
    login: () => assert.fail('Second redirect was started'),
  });
  await assert.rejects(apiFetch('/game/sessions'), ApiAuthError);
});

test('token acquisition errors are not mistaken for game-server network failures', async () => {
  const failure = new TypeError('Identity service unavailable');
  const apiFetch = makeClient({ getAccessToken: async () => { throw failure; } });
  await assert.rejects(apiFetch('/game/sessions'), (error) => error === failure);
});

test('401 starts sign-in once and never replays a POST', async () => {
  let requests = 0;
  let logins = 0;
  const apiFetch = makeClient({
    fetchImpl: async () => { requests++; return new Response('', { status: 401 }); },
    login: async () => { logins++; },
  });
  await assert.rejects(apiFetch('/game/sessions', { method: 'POST' }), ApiAuthError);
  assert.equal(logins, 1);
  assert.equal(requests, 1);
});

test('simultaneous 401 responses share one login attempt', async () => {
  let finishLogin;
  let logins = 0;
  const apiFetch = makeClient({
    fetchImpl: async () => new Response('', { status: 401 }),
    login: () => { logins++; return new Promise((resolve) => { finishLogin = resolve; }); },
  });
  const results = Promise.allSettled([apiFetch('/one'), apiFetch('/two')]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logins, 1);
  finishLogin();
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    assert.ok(result.reason instanceof ApiAuthError);
  }
});

test('failed login stays an authentication error', async () => {
  const apiFetch = makeClient({
    fetchImpl: async () => new Response('', { status: 401 }),
    login: async () => { throw new Error('Login failed'); },
  });
  await assert.rejects(apiFetch('/one'), ApiAuthError);
});

for (const status of [403, 404, 500]) {
  test(`HTTP ${status} remains an API error without re-login or demo fallback`, async () => {
    const apiFetch = makeClient({
      fetchImpl: async () => new Response('', { status }),
      login: () => assert.fail('Unexpected sign-in attempt'),
    });
    await assert.rejects(apiFetch('/one'), (error) => error instanceof ApiError &&
      !(error instanceof ApiNetworkError) && error.status === status);
  });
}

test('a failed fetch is classified as a network error', async () => {
  const apiFetch = makeClient({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(apiFetch('/one'), ApiNetworkError);
});

test('an aborted request is not a network error', async () => {
  const apiFetch = makeClient({ fetchImpl: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  await assert.rejects(apiFetch('/one'), (error) => error.name === 'AbortError' && !(error instanceof ApiNetworkError));
});

test('unmount during token acquisition prevents the HTTP request', async () => {
  const controller = new AbortController();
  const apiFetch = makeClient({
    getAccessToken: async () => { controller.abort(); return 'test-token'; },
    fetchImpl: () => assert.fail('Request was sent after cancellation'),
  });
  await assert.rejects(apiFetch('/one', { signal: controller.signal }), (error) => error.name === 'AbortError');
});

test('missing API URL fails before acquiring a token', async () => {
  const apiFetch = makeClient({ baseUrl: '', getAccessToken: () => assert.fail('Token was requested') });
  await assert.rejects(apiFetch('/one'), ApiError);
});

for (const path of ['https://other.example/one', '//other.example/one']) {
  test(`does not send an API token to ${path}`, async () => {
    const apiFetch = makeClient({ getAccessToken: () => assert.fail('Token was requested') });
    await assert.rejects(apiFetch(path), ApiError);
  });
}
