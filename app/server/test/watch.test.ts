import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { watchPaths } from '../src/watch.ts';
import { tempHome, waitFor, write } from './helpers.ts';

test('watchPaths agrupa eventos e ignora caminhos inexistentes', async () => {
  const dir = tempHome();
  let calls = 0;
  const stop = watchPaths([dir, join(dir, 'nao-existe')], () => calls++, 100);
  try {
    write(join(dir, 'a', 'b.txt'), '1');
    write(join(dir, 'c.txt'), '2');
    await waitFor(() => calls > 0, 3000);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls, 1);
  } finally {
    stop();
  }
});
