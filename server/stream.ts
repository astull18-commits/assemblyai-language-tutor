import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';

export function attachStreaming(server: Server, options: { key?: string; model: string; endpoint?: string }) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on('upgrade', (request, socket, head) => {
    if (request.url?.split('?')[0] !== '/api/stream') return;
    const origin = request.headers.origin;
    if (!origin || !['http://', 'https://'].some(scheme => origin === scheme + request.headers.host)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client));
  });
  sockets.on('connection', client => {
    const send = (event: object) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
    };
    if (!options.key) {
      send({ type: 'Error', message: 'Add ASSEMBLYAI_API_KEY to .env and restart the server.' });
      client.close();
      return;
    }
    const url = new URL(options.endpoint ?? 'wss://streaming.assemblyai.com/v3/ws');
    url.searchParams.set('sample_rate', '16000');
    url.searchParams.set('encoding', 'pcm_s16le');
    url.searchParams.set('speech_model', options.model);
    const upstream = new WebSocket(url, { headers: { Authorization: options.key }, handshakeTimeout: 10000 });
    let ready = false;
    let stopping = false;
    let stopTimer: NodeJS.Timeout | undefined;
    const beginTimer = setTimeout(() => fail('Speech service did not become ready. Please try again.'), 15000);
    const sessionTimer = setTimeout(() => fail('Session reached the 10-minute demo limit. Start a new session.'), 600000);
    function fail(message: string) {
      send({ type: 'Error', message });
      upstream.terminate();
      client.close();
    }
    function stop() {
      if (stopping) return;
      stopping = true;
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ type: 'Terminate' }));
        stopTimer = setTimeout(() => upstream.terminate(), 5000);
      } else upstream.terminate();
    }
    upstream.on('message', raw => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { fail('Invalid speech service response.'); return; }
      if (event.type === 'Begin') {
        clearTimeout(beginTimer);
        ready = true;
        send({ type: 'Begin', id: event.id, model: event.configuration?.model ?? options.model });
      } else if (event.type === 'Turn') {
        send({ type: 'Turn', turn_order: event.turn_order, transcript: event.transcript, end_of_turn: event.end_of_turn });
      } else if (event.type === 'Termination') {
        send(event);
        client.close();
        upstream.close();
      } else if (event.type === 'Error' || event.error) fail('Speech service reported an error. Check the model and account settings.');
    });
    upstream.on('error', () => fail('Could not connect to AssemblyAI. Check the API key, model access, and network.'));
    upstream.on('close', () => {
      clearTimeout(beginTimer);
      clearTimeout(sessionTimer);
      clearTimeout(stopTimer);
      if (!stopping && client.readyState === WebSocket.OPEN) send({ type: 'Error', message: 'Speech connection closed. Start a new session to reconnect.' });
      client.close();
    });
    client.on('message', (data, binary) => {
      if (binary) {
        if (!ready || stopping) return;
        const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        if (frame.length < 1600 || frame.length > 32000 || frame.length % 2 !== 0) { fail('Invalid PCM audio frame.'); return; }
        if (upstream.bufferedAmount > 128000) { fail('Network is too slow to stream live audio.'); return; }
        upstream.send(frame, { binary: true });
      } else {
        try { if (JSON.parse(data.toString()).type === 'Stop') stop(); }
        catch { fail('Invalid client message.'); }
      }
    });
    client.on('close', stop);
    client.on('error', stop);
  });
  return sockets;
}
