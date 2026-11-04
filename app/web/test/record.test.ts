import { expect, it } from 'vitest';
import { holdMic, micHeld } from '../src/voice/record.ts';

it('holdMic segura o microfone ate todas as gravacoes soltarem (soltar duas vezes nao conta)', () => {
  expect(micHeld()).toBe(false);
  const a = holdMic();
  const b = holdMic();
  a();
  a();
  expect(micHeld()).toBe(true);
  b();
  expect(micHeld()).toBe(false);
});
