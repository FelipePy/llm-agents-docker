import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isShortStop, looksIncomplete, looksLikeRequest,
  SentenceSplitter, isClear, isErase, isGoodbye, isReturn, isStopRequest, isSubmit, isUnintelligible, matchWake, normalize, stripMarkdown,
} from '../src/voice/text.ts';
import { AUDIO, FrameDecoder, JSON_KIND, encodeFrame, encodeJson } from '../src/voice/protocol.ts';

test('normalize tira acentos, pontuacao e caixa', () => {
  assert.equal(normalize('  Até   mais, JARVIS! '), 'ate mais jarvis');
});

test('isGoodbye reconhece despedidas curtas, mesmo com outras palavras', () => {
  for (const t of ['Tchau.', 'tchau, Jarvis!', 'Até mais', 'até logo', 'Valeu, tchau', 'Obrigado, Jarvis, tchau!', 'Valeu, até amanhã.', 'Por hoje é só.'])
    assert.equal(isGoodbye(t), true, t);
  for (const t of ['manda pro Claude do projeto antigo que eu disse tchau pra versão velha', 'qual o tempo', ''])
    assert.equal(isGoodbye(t), false, t);
});

test('comandos do ditado e pedidos de parada', () => {
  for (const t of ['Envia.', 'pode mandar', 'Play!', 'manda aí']) assert.equal(isSubmit(t), true, t);
  assert.equal(isSubmit('envia o relatório pro cliente'), false, 'frase com mais coisa e ditado, nao comando');
  assert.equal(isErase('Apaga isso.'), true);
  assert.equal(isClear('limpa tudo'), true);
  for (const t of ['Jarvis', 'para, para', 'espera aí', 'chega']) assert.equal(isStopRequest(t), true, t);
  assert.equal(isStopRequest('abre o projeto meu-app'), false);
});

test('SentenceSplitter: sem pontuacao, o primeiro trecho sai depois de ~8 palavras', () => {
  const s = new SentenceSplitter(20);
  assert.deepEqual(s.push('Olha só, o projeto '), []);
  assert.deepEqual(s.push('tem três mudanças pendentes no branch principal agora'), ['Olha só, o projeto tem três mudanças pendentes no branch principal']);
  assert.deepEqual(s.push(' e mais. Fim'), ['agora e mais.']);
});

test('stripMarkdown deixa so o texto falavel', () => {
  assert.equal(stripMarkdown('## Título\n- **um** item com `código` e [link](http://x)'), 'Título um item com código e link');
  assert.equal(stripMarkdown('```js\nx()\n```'), '');
});

test('SentenceSplitter corta frases conforme o texto chega', () => {
  const s = new SentenceSplitter(0);
  assert.deepEqual(s.push('Olá! Tudo'), ['Olá!']);
  assert.deepEqual(s.push(' bem? A temperatura é 3.5 graus'), ['Tudo bem?']);
  assert.deepEqual(s.push('.\nFim'), ['A temperatura é 3.5 graus.']);
  assert.equal(s.flush(), 'Fim');
  assert.equal(s.flush(), null);
});

test('SentenceSplitter solta o primeiro trecho na primeira virgula longa o bastante', () => {
  const s = new SentenceSplitter(20);
  assert.deepEqual(s.push('Oi, '), [], 'curto demais para cortar na virgula');
  assert.deepEqual(s.push('tudo certo por aqui, e com você'), ['Oi, tudo certo por aqui,']);
  assert.deepEqual(s.push(', como foi o dia? Bom'), ['e com você, como foi o dia?'], 'depois do primeiro trecho, so frases inteiras');
  assert.equal(s.flush(), 'Bom');
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

test('matchWake reconhece o chamado e separa o pedido', () => {
  assert.deepEqual(matchWake('Jarvis'), { rest: '' });
  assert.deepEqual(matchWake('Jarvis, abre o projeto meu-app.'), { rest: 'abre o projeto meu-app.' });
  assert.deepEqual(matchWake('Ei Jarvis abre as skills'), { rest: 'abre as skills' });
  assert.deepEqual(matchWake('E aí, Jarbas!'), { rest: '' });
  assert.deepEqual(matchWake('Hey Jarvis, tudo bem?'), { rest: 'tudo bem?' });
  assert.equal(matchWake('o jarvis é legal'), null);
  assert.equal(matchWake('abre o meu-app'), null);
});

test('isReturn reconhece o pedido para voltar ao Jarvis', () => {
  assert.equal(isReturn('volta'), true);
  assert.equal(isReturn('pode voltar'), true);
  assert.equal(isReturn('abre o projeto'), false);
});

test('mergeUtterances emenda a continuacao e, se for correcao, fica so com a nova', async () => {
  const { mergeUtterances, isCorrection } = await import('../src/voice/text.ts');
  assert.equal(mergeUtterances('abre o projeto meu-app.', 'e o agendarse'), 'abre o projeto meu-app e o agendarse');
  assert.equal(mergeUtterances('abre o meu-app', 'Não, abre o agendarse'), 'Não, abre o agendarse');
  assert.equal(mergeUtterances('abre o meu-app', 'quer dizer, o agendarse'), 'quer dizer, o agendarse');
  assert.ok(isCorrection('Na verdade, esquece'));
  assert.ok(!isCorrection('nos testes também'), '"nos" nao e "nao"');
});

test('isUnintelligible: ruido, hesitacoes, anotacoes, fala truncada e alucinacoes do whisper', () => {
  for (const t of [
    '', '   ', '...', 'Hmm.', 'Ahn, hã...', 'Humm hum', '[Música]', '(risos)', '♪ ♪', '*tosse*',
    'Legendas pela comunidade Amara.org', 'Obrigado por assistir!', 'Inscreva-se no canal',
    'ご視聴ありがとうございました', 'de', 'a a a a', 'não não não não não', 'Música',
  ]) assert.equal(isUnintelligible(t), true, t);
  for (const t of [
    'espera, abre o projeto meu-app', 'para', 'sim', 'não', 'ok', 'obrigado', 'e amanhã?', 'Jarvis', '42',
    'não não', 'abre o 3', 'qual a previsão pra amanhã',
  ]) assert.equal(isUnintelligible(t), false, t);
});

test('looksLikeRequest e isShortStop (interrupcoes)', () => {
  for (const t of ['e amanhã?', 'abre o meu-app', 'não, o outro', 'na verdade era o Rio', 'qual a cotação', 'pesquisa o dólar', 'por que isso'])
    assert.equal(looksLikeRequest(t), true, t);
  for (const t of ['batata voadora azul', 'o cachorro do vizinho', 'mãe, já vou']) assert.equal(looksLikeRequest(t), false, t);
  for (const t of ['para', 'Espera aí.', 'chega, Jarvis', 'pera um pouco', 'Jarvis']) assert.equal(isShortStop(t), true, t);
  for (const t of ['espera, e amanhã?', 'isso é para mim', 'para de falar do tempo e me diz o dólar']) assert.equal(isShortStop(t), false, t);
});

test('looksIncomplete: fala que para em palavra de ligacao ou sem conclusao', () => {
  for (const t of [
    'abre o projeto meu-app e', 'manda uma mensagem que', 'quero ir pra', 'qual é a previsão de', 'abre o',
    'liga o terminal do', 'abre o meu...', 'Abre o projeto,', 'cria uma tarefa para.', 'abre o projeto, hum',
  ])
    assert.equal(looksIncomplete(t), true, t);
  for (const t of ['abre o projeto meu-app', 'que horas são', 'o que é?', 'Como está o tempo hoje?', 'O que é', 'tchau', 'Oi!', 'quero ir de?', ''])
    assert.equal(looksIncomplete(t), false, t);
});
