import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { attachStreaming } from '../server/stream.js';

async function harness(key?: string) {
  const provider = new WebSocketServer({ port: 0 });
  await once(provider, 'listening');
  const server = createServer();
  const gateway = attachStreaming(server, { key, model: 'test-model', endpoint: `ws://127.0.0.1:${(provider.address() as AddressInfo).port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new WebSocket(origin.replace('http:', 'ws:') + '/api/stream', { origin });
  const events: any[] = [];
  client.on('message', raw => events.push(JSON.parse(raw.toString())));
  return { provider, client, events, async close() {
    client.terminate();
    gateway.clients.forEach(socket => socket.terminate());
    provider.clients.forEach(socket => socket.terminate());
    await Promise.all([new Promise<void>(resolve => gateway.close(() => resolve())), new Promise<void>(resolve => provider.close(() => resolve())), new Promise<void>(resolve => server.close(() => resolve()))]);
  } };
}

test('streams PCM and forwards partial, final, and final-on-stop events', { timeout: 5000 }, async () => {
  const h = await harness('test-key');
  try {
    const [upstream, request] = await once(h.provider, 'connection');
    assert.equal(request.headers.authorization, 'test-key');
    assert.match(request.url, /sample_rate=16000/);
    upstream.send(JSON.stringify({ type: 'Begin', id: 'session' }));
    await once(h.client, 'message');
    const pcm = Buffer.alloc(3200, 1);
    h.client.send(pcm);
    const [received, binary] = await once(upstream, 'message');
    assert.equal(binary, true);
    assert.deepEqual(received, pcm);
    upstream.send(JSON.stringify({ type: 'Turn', turn_order: 0, transcript: 'Hola', end_of_turn: false }));
    await once(h.client, 'message');
    h.client.send(JSON.stringify({ type: 'Stop' }));
    const [stop] = await once(upstream, 'message');
    assert.equal(JSON.parse(stop.toString()).type, 'Terminate');
    upstream.send(JSON.stringify({ type: 'Turn', turn_order: 0, transcript: 'Hola mundo.', end_of_turn: true }));
    upstream.send(JSON.stringify({ type: 'Termination', audio_duration_seconds: 1 }));
    await once(h.client, 'close');
    assert.deepEqual(h.events.map(event => event.type), ['Begin', 'Turn', 'Turn', 'Termination']);
    assert.equal(h.events[2].transcript, 'Hola mundo.');
  } finally { await h.close(); }
});

test('missing key produces an actionable error', { timeout: 5000 }, async () => {
  const h = await harness();
  try {
    await once(h.client, 'close');
    assert.match(h.events[0].message, /ASSEMBLYAI_API_KEY/);
    assert.equal(h.provider.clients.size, 0);
  } finally { await h.close(); }
});

test('browser disconnect terminates upstream session', { timeout: 5000 }, async () => {
  const h = await harness('test-key');
  try {
    const [upstream] = await once(h.provider, 'connection');
    upstream.send(JSON.stringify({ type: 'Begin', id: 'session' }));
    await once(h.client, 'message');
    const terminated = once(upstream, 'message');
    h.client.close();
    const [message] = await terminated;
    assert.equal(JSON.parse(message.toString()).type, 'Terminate');
  } finally { await h.close(); }
});
