// Mensagens enquadradas com o worker de voz: 1 byte de tipo ("A" audio,
// "J" JSON) + 4 bytes de tamanho (big-endian) + conteudo.

export const AUDIO = 0x41;
export const JSON_KIND = 0x4a;

export function encodeFrame(kind: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(kind, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export const encodeJson = (obj: unknown): Buffer => encodeFrame(JSON_KIND, Buffer.from(JSON.stringify(obj), 'utf8'));

export class FrameDecoder {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): { kind: number; payload: Buffer }[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: { kind: number; payload: Buffer }[] = [];
    while (this.buf.length >= 5) {
      const size = this.buf.readUInt32BE(1);
      if (this.buf.length < 5 + size) break;
      out.push({ kind: this.buf[0], payload: Buffer.from(this.buf.subarray(5, 5 + size)) });
      this.buf = this.buf.subarray(5 + size);
    }
    return out;
  }
}
