// Distingue a voz do usuario do eco da voz do Jarvis pelo volume.
//
// O app sabe quanto o Jarvis esta tocando a cada instante (nivel da saida).
// Enquanto ele fala, o detector aprende quanto desse som volta pelo microfone
// (o "acoplamento" do eco, que depende das caixas, do volume e do cancelamento
// de eco do navegador). Quando o microfone fica bem acima do eco previsto por
// alguns quadros seguidos, quem esta falando e o usuario.

const HISTORY = 5; // nivel da saida dos ultimos ~400 ms (o eco chega com atraso)
const RATIOS = 40; // ~3 s de amostras do acoplamento
const MIN_RATIOS = 8; // antes disso, o acoplamento ainda nao e confiavel
const MARGIN = 2.5; // ~8 dB acima do eco previsto
const STREAK = 3; // ~240 ms seguidos
const SILENT_OUT = 0.004; // saida praticamente muda (pausa entre frases)
const MIN_MIC = 0.012; // abaixo disso e ruido de fundo

export class EchoGate {
  private readonly out: number[] = [];
  private readonly ratios: number[] = [];
  private streak = 0;

  /**
   * Um quadro do microfone (nivel RMS de 0 a 1) e o nivel da saida no mesmo
   * instante. Devolve true quando a voz do usuario passa por cima do eco.
   */
  feed(mic: number, out: number): boolean {
    this.out.push(out);
    if (this.out.length > HISTORY) this.out.shift();
    const ref = Math.max(...this.out);

    let user: boolean;
    if (ref < SILENT_OUT) {
      // Jarvis calado: qualquer voz forte e o usuario.
      user = mic >= MIN_MIC;
    } else {
      const coupling = this.coupling();
      user = coupling !== null && mic >= MIN_MIC && mic > coupling * ref * MARGIN;
      // So aprende com quadros que parecem eco (a fala do usuario nao contamina).
      if (!user) {
        this.ratios.push(mic / ref);
        if (this.ratios.length > RATIOS) this.ratios.shift();
      }
    }
    this.streak = user ? this.streak + 1 : 0;
    return this.streak >= STREAK;
  }

  /** Quanto do som da saida volta pelo microfone (percentil 75 das amostras recentes). */
  coupling(): number | null {
    if (this.ratios.length < MIN_RATIOS) return null;
    const sorted = [...this.ratios].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.75)];
  }

  /** Nova fala do Jarvis: o acoplamento aprendido continua valendo. */
  resetStreak(): void {
    this.streak = 0;
  }
}
