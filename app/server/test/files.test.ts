import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readJsonl, readTextFile, parseFrontmatter, cached, MAX_TEXT } from '../src/files.ts';
import { tempHome, write } from './helpers.ts';

test('readJsonl ignora linhas invalidas e vazias', async () => {
  const f = join(tempHome(), 'a.jsonl');
  write(f, '{"a":1}\nnao e json\n\n{"a":2}\n');
  const out: unknown[] = [];
  for await (const r of readJsonl(f)) out.push(r);
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
});

test('readTextFile trunca em 64 KB e devolve null se o arquivo nao existe', async () => {
  const dir = tempHome();
  write(join(dir, 'big.md'), 'x'.repeat(MAX_TEXT + 10));
  const t = await readTextFile(join(dir, 'big.md'));
  assert.equal(t?.content.length, MAX_TEXT);
  assert.equal(t?.truncated, true);
  assert.equal(await readTextFile(join(dir, 'nada.md')), null);
});

test('parseFrontmatter le campos simples, aspas, blocos e metadata', () => {
  const fm = parseFrontmatter(
    '---\nname: minha-skill\ndescription: "Faz algo: util"\nlong: >\n  linha um\n  linha dois\nmetadata:\n  type: user\n---\ncorpo',
  );
  assert.equal(fm.name, 'minha-skill');
  assert.equal(fm.description, 'Faz algo: util');
  assert.equal(fm.long, 'linha um linha dois');
  assert.equal(fm['metadata.type'], 'user');
  assert.deepEqual(parseFrontmatter('sem frontmatter'), {});
});

test('cached so reprocessa quando o arquivo muda', async () => {
  const f = join(tempHome(), 'c.txt');
  write(f, '1', new Date(1_000_000));
  let calls = 0;
  const parse = async () => ++calls;
  assert.equal(await cached(f, parse), 1);
  assert.equal(await cached(f, parse), 1);
  write(f, '22', new Date(2_000_000));
  assert.equal(await cached(f, parse), 2);
  assert.equal(await cached(join(f, 'nao-existe'), parse), null);
});
