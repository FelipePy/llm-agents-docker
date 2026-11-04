// Escolha do usuario sobre as noticias automaticas (botao no bloco de noticias): ligadas, salvo
// quando ele desliga. Nao afeta as noticias pedidas por voz. Arquivo local do usuario (0600);
// sem arquivo, so em memoria.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class AutoNewsSetting {
  private on = true;
  private readonly file: string | undefined;

  constructor(file?: string) {
    this.file = file;
    if (!file) return;
    try {
      this.on = JSON.parse(readFileSync(file, 'utf8')).enabled !== false;
    } catch {
      // sem escolha salva: ligadas
    }
  }

  enabled(): boolean {
    return this.on;
  }

  /** Grava antes de valer: se a gravacao falhar, a escolha anterior continua. */
  set(enabled: boolean): void {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ enabled }) + '\n', { mode: 0o600 });
    }
    this.on = enabled;
  }
}
