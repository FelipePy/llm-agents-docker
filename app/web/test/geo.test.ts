import { expect, it } from 'vitest';
import { geoProblem } from '../src/geo.ts';

it('explica por que a localizacao nao veio', () => {
  expect(geoProblem({ secure: false, supported: true })).toMatch(/127\.0\.0\.1/);
  expect(geoProblem({ secure: true, supported: false })).toMatch(/não oferece/);
  expect(geoProblem({ secure: true, supported: true, errorCode: 1 })).toMatch(/bloqueada/);
  expect(geoProblem({ secure: true, supported: true, errorCode: 2 })).toMatch(/Windows/);
  expect(geoProblem({ secure: true, supported: true, errorCode: 3 })).toMatch(/demorou/);
  expect(geoProblem({ secure: true, supported: true })).toBeNull();
});
