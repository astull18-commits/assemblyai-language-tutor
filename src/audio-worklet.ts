declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

// AudioContext runs at 16 kHz. Send 100 ms signed, little-endian PCM frames.
class MicrophoneProcessor extends AudioWorkletProcessor {
  private samples = new Float32Array(1600);
  private length = 0;
  constructor() {
    super();
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        if (this.length > 0) this.emit();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  private emit() {
    const buffer = new ArrayBuffer(3200);
    const view = new DataView(buffer);
    for (let index = 0; index < this.length; index++) {
      const value = Math.max(-1, Math.min(1, this.samples[index]));
      view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    // The final short frame is padded with silence to meet minimum chunk duration.
    this.port.postMessage(buffer, [buffer]);
    this.length = 0;
  }
  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if (sampleRate !== 16000) return false;
    if (channel) for (const value of channel) {
      this.samples[this.length++] = value;
      if (this.length === this.samples.length) this.emit();
    }
    return true;
  }
}
registerProcessor('microphone-pcm', MicrophoneProcessor);
