import { FrameBatcher, Resampler, toInt16 } from './pcm.ts';

// AudioWorklet minimo: repassa cada bloco do microfone para a thread principal.
const WORKLET = `class JarvisTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('jarvis-tap', JarvisTap);`;

/** Abre o microfone e entrega quadros de 80 ms (16 kHz, PCM 16 bits). Devolve a funcao de parar. */
export async function startCapture(onFrame: (pcm: Int16Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const ctx = new AudioContext();
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, 'jarvis-tap');
    const resampler = new Resampler(ctx.sampleRate, 16000);
    const batcher = new FrameBatcher(1280);
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      for (const frame of batcher.push(toInt16(resampler.push(e.data)))) onFrame(frame);
    };
    // O worklet so processa se estiver ligado a saida; o ganho zero evita eco.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(tap);
    tap.connect(mute).connect(ctx.destination);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw err;
  }
  return () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}
