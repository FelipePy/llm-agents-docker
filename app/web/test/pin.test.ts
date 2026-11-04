import { describe, expect, it } from 'vitest';
import { pinInput, pinProblem } from '../src/pin.ts';

describe('senha numerica', () => {
  it('o campo so guarda digitos, no maximo 6', () => {
    expect([pinInput('12a3-4'), pinInput('1234567'), pinInput('abc'), pinInput(' 12 34 ')]).toEqual(['1234', '123456', '', '1234']);
  });
  it('aceita de 4 a 6 digitos e nada alem de numeros', () => {
    expect([pinProblem('1234'), pinProblem('123456')]).toEqual([null, null]);
    expect(pinProblem('123')).toMatch(/de 4 a 6/);
    expect(pinProblem('1234567')).toMatch(/de 4 a 6/);
    expect(pinProblem('12a4')).toMatch(/só números/);
  });
});
