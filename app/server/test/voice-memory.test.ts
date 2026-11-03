import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome } from './helpers.ts';
import { JarvisMemory } from '../src/voice/memory.ts';

const clock = () => {
  let t = Date.UTC(2026, 10, 3, 12, 0);
  return () => new Date((t += 60_000));
};

test('lembrar, substituir, esquecer e reabrir do arquivo (0600)', () => {
  const file = join(tempHome(), 'ui', 'jarvis-memory.json');
  const m = new JarvisMemory(file, clock());
  const nome = m.remember({ text: 'Chama-se Felipe', about: 'usuario' });
  m.remember({ text: 'meu-app usa Postgres', about: 'projeto', project: 'meu-app' });
  const cafe = m.remember({ text: 'Prefere café sem açúcar', about: 'preferencia' });
  assert.equal(statSync(file).mode & 0o777, 0o600);

  const novo = m.remember({ text: 'Prefere café com leite', about: 'preferencia', replaces: cafe.id });
  assert.equal(novo.id, cafe.id, 'substituir mantem o id');
  assert.equal(m.facts({ about: 'preferencia' }).map((f) => f.text).join(), 'Prefere café com leite');
  assert.deepEqual(m.facts({ project: 'MEU-APP' }).map((f) => f.text), ['meu-app usa Postgres']);

  assert.equal(m.forget({ text: 'postgres' }), 1);
  assert.equal(m.forget({ id: 'nao-existe' }), 0);
  const reopened = new JarvisMemory(file);
  assert.deepEqual(reopened.facts().map((f) => f.id), [nome.id, cafe.id]);
  assert.equal(reopened.forget({ about: 'usuario' }), 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).facts.length, 1);
});

test('limite de 300 fatos: saem os menos atualizados', () => {
  const m = new JarvisMemory(join(tempHome(), 'm.json'), clock());
  const first = m.remember({ text: 'fato 0', about: 'outro' });
  for (let i = 1; i < 300; i++) m.remember({ text: `fato ${i}`, about: 'outro' });
  m.remember({ text: 'fato 0 atualizado', about: 'outro', replaces: first.id });
  m.remember({ text: 'fato 300', about: 'outro' });
  const texts = m.facts().map((f) => f.text);
  assert.equal(texts.length, 300);
  assert.ok(texts.includes('fato 0 atualizado'));
  assert.ok(!texts.includes('fato 1'));
});

test('conversas: resumo do modelo, ou a lista de pedidos; no maximo 20', () => {
  const m = new JarvisMemory(join(tempHome(), 'm.json'), clock());
  m.startConversation();
  m.endConversation();
  assert.equal(m.conversations().length, 0, 'sem pedidos nao registra');

  m.startConversation();
  m.noteRequest('abre o meu-app');
  m.noteRequest('como estão os testes?');
  m.endConversation();
  m.startConversation();
  m.noteRequest('qualquer coisa');
  m.setSummary('Revisamos os testes do meu-app.');
  m.endConversation();
  m.endConversation(); // repetido: nao duplica
  assert.deepEqual(m.conversations().map((c) => c.text), [
    'Pedidos: abre o meu-app; como estão os testes?',
    'Revisamos os testes do meu-app.',
  ]);
  for (let i = 0; i < 25; i++) {
    m.startConversation();
    m.noteRequest(`p${i}`);
    m.endConversation();
  }
  assert.equal(m.conversations().length, 20);
});

test('render agrupa os fatos com id e mostra as 5 ultimas conversas', () => {
  const m = new JarvisMemory(join(tempHome(), 'm.json'), clock());
  assert.equal(m.render(), '');
  const f = m.remember({ text: 'Chama-se Felipe', about: 'usuario' });
  m.remember({ text: 'usa Postgres', about: 'projeto', project: 'meu-app' });
  for (let i = 0; i < 7; i++) {
    m.startConversation();
    m.setSummary(`conversa ${i}`);
    m.noteRequest('x');
    m.endConversation();
  }
  const out = m.render();
  assert.match(out, new RegExp(`Sobre o usuário:\\n- \\[${f.id}\\] Chama-se Felipe`));
  assert.match(out, /Projetos:\n- \[\w+\] \(meu-app\) usa Postgres/);
  assert.ok(!out.includes('conversa 1'), 'so as 5 ultimas');
  assert.match(out, /Últimas conversas:\n- .*conversa 2/);
});
