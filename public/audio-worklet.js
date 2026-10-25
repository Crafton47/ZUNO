/* Capture in the audio rendering thread; emit 100 ms PCM16 chunks at 16 kHz. */
class VibeCapture extends AudioWorkletProcessor {
  constructor() { super(); this.sum = 0; this.count = 0; this.phase = 0; this.chunk = []; }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const sample of samples) {
      this.sum += sample; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.chunk.push(Math.round(Math.max(-1, Math.min(1, this.sum / this.count)) * 32767));
        this.sum = 0; this.count = 0;
        if (this.chunk.length === 1600) {
          const buffer = new ArrayBuffer(3200); const view = new DataView(buffer);
          this.chunk.forEach((value, i) => view.setInt16(i * 2, value, true));
          this.port.postMessage(buffer, [buffer]); this.chunk = [];
        }
      }
    }
    return true;
  }
}
registerProcessor('vibe-capture', VibeCapture);
