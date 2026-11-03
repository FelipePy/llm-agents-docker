// Efeitos sonoros curtos da interface (sintetizados, sem arquivos de audio).

let ctx: AudioContext | undefined;

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

const TONES = {
  /** Clique comum (botoes, cartoes, abas). */
  tap: { from: 1250, to: 760, ms: 55, gain: 0.045, type: 'triangle' as OscillatorType },
  /** Entrar num nivel ou abrir algo (planetas, projetos). */
  open: { from: 520, to: 980, ms: 110, gain: 0.05, type: 'sine' as OscillatorType },
};

export type Sound = keyof typeof TONES;

export function playSound(kind: Sound = 'tap'): void {
  try {
    const c = audio();
    const tone = TONES[kind];
    const t = c.currentTime;
    const end = t + tone.ms / 1000;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.from, t);
    osc.frequency.exponentialRampToValueAtTime(tone.to, end);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(tone.gain, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(end + 0.02);
  } catch {
    // sem audio disponivel: ignora
  }
}
