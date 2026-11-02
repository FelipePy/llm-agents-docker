import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SentenceSplitter, isGoodbye, normalize, stripMarkdown } from '../src/voice/text.ts';
import { AUDIO, FrameDecoder, JSON_KIND, encodeFrame, encodeJson } from '../src/voice/protocol.ts';

test('normalize tira acentos, pontuacao e caixa', () => {
  assert.equal(normalize('  Até   mais, JARVIS! '), 'ate mais jarvis');
});

test('isGoodbye reconhece so despedidas exatas', () => {
  for (const t of ['Tchau.', 'tchau, Jarvis!', 'Até mais', 'até logo', 'Valeu, tchau']) assert.equal(isGoodbye(t), true, t);
  for (const t of ['tchau para o projeto antigo', 'qual o tempo', '']) assert.equal(isGoodbye(t), false, t);
});

test('stripMarkdown deixa so o texto falavel', () => {
  assert.equal(stripMarkdown('## Título\n- **um** item com `código` e [link](http://x)'), 'Título um item com código e link');
  assert.equal(stripMarkdown('```js\nx()\n```'), '');
});

test('SentenceSplitter corta frases conforme o texto chega', () => {
  const s = new SentenceSplitter();
  assert.deepEqual(s.push('Olá! Tudo'), ['Olá!']);
  assert.deepEqual(s.push(' bem? A temperatura é 3.5 graus'), ['Tudo bem?']);
  assert.deepEqual(s.push('.\nFim'), ['A temperatura é 3.5 graus.']);
  assert.equal(s.flush(), 'Fim');
  assert.equal(s.flush(), null);
});

test('FrameDecoder junta pedacos e separa mensagens', () => {
  const data = Buffer.concat([encodeFrame(AUDIO, Buffer.from([1, 2, 3])), encodeJson({ event: 'ready' })]);
  const d = new FrameDecoder();
  assert.deepEqual(d.push(data.subarray(0, 4)), []);
  const frames = d.push(data.subarray(4));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].kind, AUDIO);
  assert.deepEqual([...frames[0].payload], [1, 2, 3]);
  assert.equal(frames[1].kind, JSON_KIND);
  assert.deepEqual(JSON.parse(frames[1].payload.toString()), { event: 'ready' });
});
