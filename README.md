# AssemblyAI language tutor — translation and practice

A local TypeScript reference app that captures microphone audio and displays AssemblyAI streaming transcripts. Completed speech turns now trigger translations and short teaching responses through AssemblyAI’s LLM Gateway. Recent conversation supports follow-up questions. Choose a practice language or explicitly name a language in your request. You can also type a request. Stop the microphone, then select Hear translation or Hear slowly for browser speech playback.

## Run

Requires Node.js 22+, npm, Git, an AssemblyAI account with Streaming and LLM Gateway access, and a modern browser with microphone access. Streaming and teaching requests use your AssemblyAI account and may incur usage charges.

```sh
git clone https://github.com/astull18-commits/assemblyai-language-tutor.git
cd assemblyai-language-tutor
npm ci
cp .env.example .env
# Set ASSEMBLYAI_API_KEY in .env using your editor.
npm run dev
```

Open http://localhost:3000, allow microphone access, and select **Start microphone**. Try “How do I say good morning in Spanish?” followed by “Buenos días.” Select **Stop** to flush the remaining audio and receive the final transcript. A new session preserves previous text until you select **Clear transcript**.

Keep the terminal running while using the app. If the website becomes unavailable, run `npm run dev` again from the project directory. This is a local app served on your computer. The private GitHub repository requires access before cloning.

To test translation, choose Spanish, ask “How do I say I would like a coffee?”, and pause. The tutor displays the translated phrase and its English meaning. Ask “And how would I ask for it iced?” to test conversation context. Stop recording and select **Hear translation** or **Hear slowly** to practice. The text input supports the same teaching flow without microphone access.

The app reads `.env` from the repository working directory. Restart after editing it. The default model is explicitly pinned to `universal-3-6-pro`; change `ASSEMBLYAI_MODEL` to a streaming model available to your account. The model reported by the Begin event appears in the interface.

| Variable | Purpose | Default |
| --- | --- | --- |
| `ASSEMBLYAI_API_KEY` | Server-side API credential | Required |
| `ASSEMBLYAI_MODEL` | Streaming recognition model | `universal-3-6-pro` |
| `ASSEMBLYAI_TUTOR_MODEL` | Teaching model through LLM Gateway | `qwen3.5-4b-32k-fast` |
| `PORT` | Local web server port | `3000` |

The credential belongs in the ignored `.env` file. `.env.example` contains placeholders for setup. Model access depends on the AssemblyAI account.

```sh
npm run build
npm start
npm test
```

The server binds to loopback for local development. A hosted version needs HTTPS, authentication, usage controls, and deployment configuration before exposing the billable streaming endpoint.

## Architecture

Browser microphone → AudioContext at 16 kHz → AudioWorklet → backend WebSocket → AssemblyAI v3 streaming API → transcript events → browser.

Completed transcript → queued tutor request → Express `/api/tutor` → AssemblyAI LLM Gateway → validated JSON phrase, language code, and explanation → browser display → user-triggered browser speech synthesis.

- `src/main.ts` owns capture, connection state, stop/flush behavior, and transcript rendering.
- `src/audio-worklet.ts` batches mono audio into 100 ms signed 16-bit little-endian PCM frames. The browser audio engine resamples input to the 16 kHz AudioContext. Unsupported rates produce a visible error. Final short frames are zero-padded.
- `server/stream.ts` authenticates with a server-only key, validates same-origin connections and PCM frame sizes, limits queued audio, forwards transcript events, and terminates upstream sessions after stop/disconnect.
- `server/index.ts` serves the UI and API from one origin, using Vite in development.

Capture starts after AssemblyAI's Begin acknowledgement. Each turn is updated by `turn_order`, so partial and formatted/final updates replace the same paragraph. Sessions use separate turn maps. Stop flushes worklet audio before requesting Terminate and waits for the provider's final events. Connection failures require an explicit new session to avoid replaying uncertain audio. A ten-minute demo limit bounds abandoned sessions.

The worklet is TypeScript compiled by Vite into a separate browser asset. The UI uses standard DOM APIs, avoiding an additional frontend framework for this milestone.

The backend keeps credentials out of the browser. A shared origin simplifies local HTTP and WebSocket connections. Completed turns are deduplicated before teaching requests. Teaching requests run sequentially so follow-ups receive the preceding response. Temperature is set to zero and the prompt requests JSON, which the server validates before returning it. Playback requires a button press after capture stops to keep tutor speech out of microphone input.

## Verification

`npm run build` performs strict TypeScript checking and a production bundle. `npm test` uses a local WebSocket provider fixture to verify actual PCM forwarding, partial/final transcripts, final delivery during shutdown, missing-key behavior, and upstream termination when the browser disconnects. These tests do not call AssemblyAI and do not prove transcription accuracy.

Manual live check with a configured key:

1. Start capture and confirm the browser microphone indicator and Listening state.
2. Speak a sentence, pause, and check partial then completed text.
3. Try English and Spanish phrases, including hesitation.
4. Stop mid-sentence and confirm final text appears and the microphone indicator clears.
5. Start again and confirm earlier paragraphs remain without being overwritten.
6. Deny microphone access or disconnect the network and verify the visible error and ability to restart.

## Data handling and limitations

The backend does not persist or log audio or transcripts. The browser retains transcripts in memory until cleared or refreshed. Audio is transmitted to AssemblyAI, whose account settings and policies govern provider-side retention. A Google Fonts stylesheet is used for typography.

This version does not assess pronunciation. Teaching uses `qwen3.5-4b-32k-fast`, verified with the configured account, and validates the returned JSON. Override ASSEMBLYAI_TUTOR_MODEL to use another available model that can produce JSON. Playback uses browser-provided speech synthesis voices and is enabled after microphone capture stops, preventing tutor audio from being transcribed. Browser voice availability varies. Live transcription requires your API key and a real microphone check. The automated provider fixture does not substitute for that check. The server currently uses the global AssemblyAI endpoint; customer-specific residency requirements need explicit configuration and validation.

Protocol reference: https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket

## Troubleshooting

- **Safari cannot connect** — confirm `npm run dev` is still running and open the port printed in the terminal.
- **Microphone permission denied** — in Safari, open Settings → Websites → Microphone and allow access for localhost, then reload.
- **API key required** — check `.env`, restart the server, and refresh the page.
- **Translation unavailable** — verify the account has access to the configured LLM Gateway model and sufficient balance. Transcription and teaching are separate requests and can fail independently.
- **No spoken playback** — stop recording first, then select a speech button. Available voices depend on the browser and operating system.

## Current scope

This reference implementation includes recognition, translation, contextual follow-ups, and manual speech playback. It does not yet include automatic spoken turn-taking, pronunciation scoring, an incumbent-provider adapter, or an evaluation report. Translation examples were manually checked through the live Gateway; a small set of checks is insufficient to establish quality across languages and learner groups. The automated tests currently cover the streaming relay. Browser microphone behavior and speech playback require manual checks on the target device.

## Translation architecture

`server/tutor.ts` validates requests, calls AssemblyAI LLM Gateway, and checks responses. `src/tutor.ts` queues completed turns, keeps the last six exchanges for follow-ups, and renders translations plus browser speech controls. Clearing the conversation aborts pending requests and discards late replies. Transcripts and recent history are sent to the Gateway, with provider-side handling governed by account settings.
