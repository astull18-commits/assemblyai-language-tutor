import workletUrl from './audio-worklet.ts?worker&url';
import './style.css';
import { createTutor } from './tutor';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main><header><span class="brand">Voice practice</span><span>Powered by AssemblyAI</span></header>
  <section class="intro"><p class="eyebrow">LANGUAGE LAB</p><h1>Every conversation<br>starts with a word.</h1><p>Ask how to say it. Get a translation and practice the phrase.</p></section>
  <section class="workspace" aria-label="Live transcription"><div class="toolbar"><span id="status" role="status">Checking connection…</span><span id="model"></span></div>
  <div id="transcript" role="log" aria-label="Transcript" aria-live="polite"><p class="placeholder">Try “How do I say good morning in Spanish?”</p></div>
  <p id="error" role="alert" hidden></p><footer><button id="start" disabled>Start microphone</button><button id="stop" disabled>Stop</button><button id="clear">Clear transcript</button></footer></section>
  <p class="privacy">While recording, audio is sent to AssemblyAI for transcription. Requests and recent conversation are sent to AssemblyAI’s LLM Gateway for teaching responses. Conversation history stays in this tab.</p></main>`;
const { requestLesson, clearLessons, setRecording } = createTutor();
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = element<HTMLButtonElement>('start');
const stop = element<HTMLButtonElement>('stop');
const clear = element<HTMLButtonElement>('clear');
const status = element('status');
const error = element('error');
const transcript = element('transcript');
let stream: MediaStream | undefined;
let context: AudioContext | undefined;
let node: AudioWorkletNode | undefined;
let source: MediaStreamAudioSourceNode | undefined;
let socket: WebSocket | undefined;
let stopping = false;
let session = 0;
let flushDone: (() => void) | undefined;
let stopTimeout: ReturnType<typeof setTimeout> | undefined;
let connectTimeout: ReturnType<typeof setTimeout> | undefined;
const turns = new Map<number, HTMLParagraphElement>();
const translatedTurns = new Set<number>();

function releaseAudio() {
  stream?.getTracks().forEach(track => track.stop());
  source?.disconnect();
  node?.disconnect();
  void context?.close().catch(() => {});
  stream = undefined; context = undefined; node = undefined; source = undefined;
}
function reset() {
  setRecording(false);
  clearTimeout(stopTimeout); clearTimeout(connectTimeout);
  releaseAudio();
  socket = undefined;
  start.disabled = false; stop.disabled = true; clear.disabled = false;
  status.textContent = error.hidden ? 'Ready to practice' : 'Session ended';
}
function showError(message: string) {
  error.textContent = message; error.hidden = false;
}
clear.onclick = () => { transcript.replaceChildren(); turns.clear(); clearLessons(); };
start.onclick = async () => {
  const currentSession = ++session;
  translatedTurns.clear();
  setRecording(true);
  error.hidden = true; start.disabled = true; clear.disabled = true; stopping = false; turns.clear();
  status.textContent = 'Requesting microphone…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture requires localhost or HTTPS.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    context = new AudioContext({ sampleRate: 16000 });
    await context.resume();
    if (context.sampleRate !== 16000) throw new Error('This browser cannot capture at 16 kHz. Try a current version of Chrome.');
    await context.audioWorklet.addModule(workletUrl);
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'microphone-pcm');
    node.onprocessorerror = () => { showError('Audio capture stopped unexpectedly. Please restart.'); socket?.close(); releaseAudio(); };
    stream.getAudioTracks()[0].onended = () => { showError('Microphone disconnected.'); socket?.close(); releaseAudio(); };
    const activeSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/stream`);
    socket = activeSocket;
    status.textContent = 'Connecting to AssemblyAI…';
    connectTimeout = setTimeout(() => { showError('Connection timed out. Please try again.'); activeSocket.close(); releaseAudio(); }, 20000);
    node.port.onmessage = event => {
      if (event.data?.type === 'flushed') { flushDone?.(); return; }
      if (activeSocket.readyState === WebSocket.OPEN) {
        if (activeSocket.bufferedAmount > 128000) { showError('Network too slow for live audio. Please restart.'); activeSocket.close(); releaseAudio(); return; }
        activeSocket.send(event.data);
      }
    };
    activeSocket.onmessage = event => {
      if (currentSession !== session) return;
      const message = JSON.parse(event.data);
      if (message.type === 'Begin') {
        clearTimeout(connectTimeout);
        element('model').textContent = message.model;
        transcript.querySelector('.placeholder')?.remove();
        source!.connect(node!); node!.connect(context!.destination);
        stop.disabled = false; status.textContent = '● Listening';
      } else if (message.type === 'Turn') {
        let paragraph = turns.get(message.turn_order);
        if (!paragraph) { paragraph = document.createElement('p'); turns.set(message.turn_order, paragraph); transcript.append(paragraph); }
        paragraph.textContent = message.transcript;
        paragraph.className = message.end_of_turn ? 'final' : 'partial';
        transcript.scrollTop = transcript.scrollHeight;
        if (message.end_of_turn && message.transcript.trim() && !translatedTurns.has(message.turn_order)) {
          translatedTurns.add(message.turn_order);
          requestLesson(message.transcript);
        }
      } else if (message.type === 'Error') showError(message.message);
      else if (message.type === 'Termination') { stopping = true; status.textContent = 'Transcript complete'; }
    };
    activeSocket.onerror = () => showError('Could not reach the streaming server. Check that it is running.');
    activeSocket.onclose = () => {
      if (currentSession !== session) return;
      if (!stopping && error.hidden) showError('Connection ended. Start a new session to reconnect.');
      reset();
    };
  } catch (failure) {
    showError(failure instanceof Error ? failure.message : 'Unable to start microphone.');
    socket?.close(); reset();
  }
};
stop.onclick = async () => {
  stopping = true; stop.disabled = true; status.textContent = 'Finishing transcript…';
  source?.disconnect();
  await new Promise<void>(resolve => {
    flushDone = resolve;
    node?.port.postMessage('flush');
    setTimeout(resolve, 250);
  });
  flushDone = undefined;
  releaseAudio();
  setRecording(false);
  if (socket?.readyState !== WebSocket.OPEN) { reset(); return; }
  socket.send(JSON.stringify({ type: 'Stop' }));
  stopTimeout = setTimeout(() => { showError('Timed out waiting for the final transcript.'); socket?.close(); }, 7000);
};
window.addEventListener('pagehide', () => { releaseAudio(); socket?.close(); clearLessons(); });
async function checkConfiguration() {
try {
  const response = await fetch('/api/health');
  const health = await response.json();
  element('model').textContent = health.model;
  status.textContent = health.configured ? 'Ready to practice' : 'API key required';
  start.disabled = !health.configured;
  if (!health.configured) showError('Add your AssemblyAI API key to the server’s .env file, then restart and refresh.');
} catch { showError('Server unavailable. Start the app and refresh.'); status.textContent = 'Disconnected'; }

}
void checkConfiguration();
