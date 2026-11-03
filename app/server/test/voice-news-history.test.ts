import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome } from './helpers.ts';
import { NEWS_TTL_MS, NewsHistory } from '../src/voice/news-history.ts';

const item = (title: string) => ({ title, source: 'G1', link: '', published: '' });

test('historico de noticias: filtra as ja apresentadas, persiste (0600) e expira em 2 dias', () => {
  let now = Date.UTC(2026, 10, 3, 12);
  const file = join(tempHome(), 'ui', 'jarvis-news.json');
  const h = new NewsHistory(file, () => now);
  h.mark([item('Chuva forte em SP')]);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(h.fresh([item('chuva forte em SP!'), item('Outra')]).map((n) => n.title), ['Outra'], 'ignora caixa e pontuacao');

  const reopened = new NewsHistory(file, () => now);
  assert.ok(reopened.has('Chuva forte em SP'), 'vale entre sessoes');

  now += NEWS_TTL_MS - 1;
  assert.ok(reopened.has('Chuva forte em SP'));
  now += 1;
  assert.ok(!reopened.has('Chuva forte em SP'), 'depois de 2 dias pode voltar');
});

test('historico sem arquivo fica so em memoria', () => {
  const h = new NewsHistory();
  h.mark([item('A')]);
  assert.ok(h.has('A'));
  assert.ok(!h.has('B'));
});
