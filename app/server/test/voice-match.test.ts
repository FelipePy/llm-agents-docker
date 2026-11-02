import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProject, resolveProject } from '../src/voice/tools.ts';
import type { ProjectSummary } from '../src/types.ts';

const p = (name: string): ProjectSummary => ({ id: name, name, path: `/w/${name}`, updatedAt: '', conversations: 1, agents: ['claude'] });
const list = ['Nowcasting', 'Nowcasting-Geoserver', 'Nowcasting-Geoserver-API', 'meu-app', 'agendarse', 'llm-agents-docker'].map(p);

test('nomes falados com espacos, hifens e caixa diferentes', () => {
  assert.equal(findProject(list, 'now casting geo server')?.name, 'Nowcasting-Geoserver');
  assert.equal(findProject(list, 'Nowcasting Geoserver API')?.name, 'Nowcasting-Geoserver-API');
  assert.equal(findProject(list, 'o projeto nowcasting')?.name, 'Nowcasting');
  assert.equal(findProject(list, 'LLM agents docker')?.name, 'llm-agents-docker');
  assert.equal(findProject(list, 'meu app')?.name, 'meu-app');
});

test('erros de transcricao ainda acham o projeto', () => {
  assert.equal(findProject(list, 'nowcast geoserver')?.name, 'Nowcasting-Geoserver');
  assert.equal(findProject(list, 'agenda-se')?.name, 'agendarse');
  assert.equal(findProject(list, 'banana'), null);
});

test('quando dois nomes ficam parecidos demais, devolve os candidatos', () => {
  const r = resolveProject(list, 'geoserver');
  assert.equal(r.project, undefined);
  assert.deepEqual(r.candidates.map((c) => c.name).sort(), ['Nowcasting-Geoserver', 'Nowcasting-Geoserver-API']);
  assert.equal(resolveProject(list, 'now casting geo server').project?.name, 'Nowcasting-Geoserver');
});
