import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameSocketUrl, connectGameSocket } from '../src/api/gameSocket.js';
import { ApiAuthError, ApiError } from '../src/api/apiFetch.js';

class Socket {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(data) { assert.equal(this.readyState, 1); this.sent.push(JSON.parse(data)); }
  receive(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  serverClose(code) { this.readyState = 3; this.onclose?.({ code }); }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function connect(options = {}) {
  return connectGameSocket({ baseUrl: 'https://api.example', sessionId: 'owned',
    getAccessToken: async () => 'private-token', WebSocketImpl: Socket, ...options });
}
function latest() { return Socket.instances.at(-1); }
async function ready(options = {}) {
  const promise = connect(options);
  await flush();
  const ws = latest();
  ws.open();
  ws.receive({ type: 'auth_ok', session_id: 'owned' });
  return { connection: await promise, ws };
}

test('URL uses WSS and never includes the token or query', () => {
  assert.equal(buildGameSocketUrl('https://api.example/base', 'owned'), 'wss://api.example/game/sessions/owned/ws');
  assert.equal(buildGameSocketUrl('http://127.0.0.1:8000', 'owned'), 'ws://127.0.0.1:8000/game/sessions/owned/ws');
  assert.equal(new URL(buildGameSocketUrl('https://api.example', 'bad/?token=secret')).search, '');
});
for (const address of ['http://api.example', 'ftp://api.example', 'wss://api.example', 'https://user:pass@api.example', 'https://api.example/?token=x', 'https://api.example/#secret', '']) {
  test(`rejects unsafe address: ${address}`, () => assert.throws(() => buildGameSocketUrl(address, 'owned'), ApiError));
}

test('gets token before opening; auth is first frame; waits for matching ack', async () => {
  let release;
  const before = Socket.instances.length;
  const received = [];
  let settled = false;
  const promise = connect({ getAccessToken: () => new Promise(resolve => { release = resolve; }), onMessage: m => received.push(m) });
  promise.then(() => { settled = true; });
  assert.equal(Socket.instances.length, before);
  release('private-token');
  await flush();
  const ws = latest();
  assert.equal(ws.url.includes('private-token'), false);
  assert.equal(ws.sent.length, 0);
  ws.open();
  assert.deepEqual(ws.sent, [{ type: 'auth', token: 'private-token' }]);
  assert.equal(settled, false);
  assert.deepEqual(received, []);
  ws.receive({ type: 'auth_ok', session_id: 'owned' });
  const connection = await promise;
  assert.equal(connection.send({ type: 'pose_data', data: {} }), true);
  ws.receive({ type: 'stats_update', data: { score: 12 } });
  assert.equal(received[0].data.score, 12);
  connection.close();
});

for (const token of [null, '', '   ', 123]) {
  test(`missing token ${JSON.stringify(token)} never opens socket`, async () => {
    const before = Socket.instances.length;
    await assert.rejects(connect({ getAccessToken: async () => token }), ApiAuthError);
    assert.equal(Socket.instances.length, before);
  });
}

test('MSAL error passes through without socket or another login', async () => {
  const before = Socket.instances.length;
  const error = new Error('MSAL failed');
  await assert.rejects(connect({ getAccessToken: async () => { throw error; } }), e => e === error);
  assert.equal(Socket.instances.length, before);
});

test('abort while token is pending prevents connection', async () => {
  const controller = new AbortController();
  let release;
  const before = Socket.instances.length;
  const promise = connect({ signal: controller.signal, getAccessToken: () => new Promise(resolve => { release = resolve; }) });
  const rejected = assert.rejects(promise, { name: 'AbortError' });
  controller.abort();
  release('token');
  await rejected;
  assert.equal(Socket.instances.length, before);
});

test('abort during handshake closes connecting socket', async () => {
  const controller = new AbortController();
  const promise = connect({ signal: controller.signal });
  const rejected = assert.rejects(promise, { name: 'AbortError' });
  await flush();
  const ws = latest();
  controller.abort();
  await rejected;
  assert.equal(ws.readyState, 3);
  assert.deepEqual(ws.sent, []);
});

for (const message of [{ type: 'stats_update', data: { score: 99 } }, { type: 'auth_ok', session_id: 'foreign' }]) {
  test(`rejects ${message.type} before valid owner ack`, async () => {
    const received = [];
    const promise = connect({ onMessage: m => received.push(m) });
    const rejected = assert.rejects(promise, ApiAuthError);
    await flush();
    const ws = latest();
    ws.open(); ws.receive(message);
    await rejected;
    assert.equal(ws.readyState, 3);
    assert.deepEqual(received, []);
    assert.equal(ws.sent.length, 1);
  });
}

for (const code of [4401, 4403, 1011, 1006]) {
  test(`server rejection ${code} fails visibly without retry`, async () => {
    const before = Socket.instances.length;
    const promise = connect();
    const rejected = assert.rejects(promise, error => code === 4401 ? error instanceof ApiAuthError : error instanceof ApiError);
    await flush();
    latest().open(); latest().serverClose(code);
    await rejected;
    assert.equal(Socket.instances.length, before + 1);
  });
}

test('authentication timeout closes socket', async () => {
  const promise = connect({ timeoutMs: 10 });
  const rejected = assert.rejects(promise, /timed out/);
  await rejected;
  assert.equal(latest().readyState, 3);
});

test('expiry after authentication stops poses and reports once', async () => {
  const errors = [];
  const { connection, ws } = await ready({ onDisconnect: e => errors.push(e) });
  ws.serverClose(4401);
  assert.equal(connection.send({ type: 'pose_data' }), false);
  ws.onerror?.();
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof ApiAuthError);
});

test('intentional end closes without a spurious game error', async () => {
  const errors = [];
  const { connection, ws } = await ready({ onDisconnect: e => errors.push(e) });
  connection.close();
  assert.equal(connection.send({ type: 'request_stats' }), false);
  assert.equal(ws.readyState, 3);
  assert.deepEqual(errors, []);
});

test('invalid JSON after authentication closes with visible error', async () => {
  const errors = [];
  const { connection, ws } = await ready({ onDisconnect: e => errors.push(e) });
  ws.onmessage({ data: '{' });
  assert.equal(errors.length, 1);
  assert.equal(connection.send({ type: 'pose_data' }), false);
});
