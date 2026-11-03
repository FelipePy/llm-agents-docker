# Jarvis: evoluir o próprio código por voz e memória entre sessões

Data: 2026-11-03 · Branch: `feat/voice`

## 1. Evoluir o Jarvis por voz (opção C: fluxo no projeto + conhecimento no repositório)

### Objetivo
"Jarvis, quero que você aprenda a X" vira uma funcionalidade nova no próprio repositório do Jarvis, desenvolvida por uma
sessão do Claude Code, aplicada só com o "ok" do usuário, com reinício verificado e volta automática para a versão
anterior se algo falhar. No fim, o Jarvis diz que a atualização deu certo e que as verificações passaram.

### Conhecimento: `CLAUDE.md` na raiz do repositório
Lido automaticamente pelo Claude Code em qualquer sessão no repositório (por voz ou pelo terminal), versionado com o
código. Conteúdo:
- **Arquitetura:** servidor Node (`app/server`), interface React/Three (`app/web`), worker Python de voz (`app/voice`)
  e app desktop Tauri (`app/desktop`).
- **Receita de um comando de voz novo:**
  1. ferramenta em `voice/tools.ts`;
  2. entrada em `voice/commands.ts` (o teste exige uma por ferramenta);
  3. instrução no `JARVIS_PROMPT` se preciso;
  4. testes;
  5. linha no README.
- **Comandos de verificação:**
  - servidor: testes e typecheck;
  - web: testes, `tsc` e build;
  - worker: `python -m unittest`;
  - `tests/ui.test.sh`.
- **Regras do projeto:**
  - textos para o usuário em português;
  - sem shell livre nas ferramentas do Jarvis;
  - commits pequenos com testes;
  - não mexer em `app/desktop` sem avisar que isso exige instalador novo (via CI).

### Fluxo
O desenvolvimento só começa depois de **dois "ok"** do usuário e roda **em background**: a conversa com o Jarvis continua
livre (outros pedidos, outros assuntos) enquanto a sessão de evolução trabalha.

**1. Conversa de definição (com o próprio Jarvis, por voz)**
- "Jarvis, vamos desenvolver uma funcionalidade nova para você" inicia a definição. O Jarvis conduz:
  - pergunta uma coisa por vez (no máximo 4 ou 5): o que dispara, o que ele deve dizer ou fazer, onde aparece na tela, casos de borda;
  - o usuário responde, muda de ideia ou fala de outras coisas no meio. A proposta fica guardada e não se perde ao trocar de assunto nem ao reiniciar.
- Ferramenta `rascunhar_evolucao({ titulo, especificacao })`: grava ou atualiza a proposta (estado `rascunho`) em `~/.config/llm-agent/ui/evolution.json`.
  - A especificação é um texto estruturado (objetivo, comportamento, onde aparece, casos de borda, fora do escopo) e é exatamente o que a sessão de desenvolvimento vai receber.

**2. Primeiro OK ("está tudo ok, pode seguir")**
- Ferramenta `resumir_evolucao({ resumo })`: o Jarvis lê o **resumo do que vai desenvolver** (3 a 5 frases) e pergunta "Posso começar?". A proposta passa a `aguardando_ok`.

**3. Segundo OK ("pode começar")**
- Ferramenta `iniciar_evolucao()`. O servidor só aceita se a proposta estiver em `aguardando_ok` e tiver sido marcada assim num turno **anterior** do usuário.
- Assim, o modelo não consegue resumir e iniciar na mesma resposta: o usuário sempre ouve o resumo e responde antes.
- Mudanças depois do resumo (`rascunhar_evolucao`) voltam a proposta para `rascunho`, e o resumo é relido.

**4. Desenvolvimento em background**
- Cria um **clone local** do repositório em `~/.local/share/llm-agent/jarvis-dev/<slug>`, com `git clone --local` e uma branch `jarvis/<slug>` a partir do commit atual.
  - Por que não uma git worktree: os agentes rodam no container, que monta só a pasta do projeto. O `.git` de uma worktree aponta para fora dela, e o git quebraria lá dentro. O clone é autocontido.
- Abre nesse clone uma sessão do Claude (não vai para a tela). O prompt traz a especificação aprovada e a orientação: "siga o CLAUDE.md; não pare para perguntar: decida pelo mais simples e anote as decisões; rode todas as verificações, faça commits na branch e termine com um resumo de 1–2 frases em `.jarvis/summary.txt`" (pasta ignorada pelo git).
- O Jarvis responde curto ("Comecei, te aviso quando terminar") e segue conversando normalmente sobre qualquer assunto.

**5. Acompanhar**
- Hoje o Jarvis já acompanha sessões. Quando a sessão de evolução termina (o agente fica ocioso com commits novos e `summary.txt` presente), o anúncio espontâneo diz: "Terminei <resumo>. Quer aplicar?"
- `status_evolucao()` responde a qualquer momento ("como está a funcionalidade nova?"), resumindo o fim da saída da sessão.
- O aviso de "terminei" espera o fim de uma conversa em andamento, como os outros anúncios.

**6. Aplicar: ferramenta `aplicar_evolucao()`, só depois do "sim" do usuário**

*Pré-checagens (se falham, ele diz o motivo e não aplica nada):*
- o repositório principal sem alterações pendentes;
- a branch com commits novos;
- verificações rodando **no host, no clone**: testes e typecheck do servidor, testes e build da web, testes do worker.

*Avisos antes de aplicar:*
- se houver sessões de terminal abertas além da de evolução: "Reiniciar fecha N sessões abertas (as conversas continuam no histórico). Aplico mesmo?". Isso vira um parâmetro `confirmar_fechar_sessoes`;
- se a branch mexer em `app/desktop`: "a parte do app desktop só vale com um instalador novo". Nesse caso, ele também faz push da branch para o CI gerar o instalador.

*Aplicação:*
- grava `~/.config/llm-agent/ui/update.json` com `{ from, to, summary, startedAt }`;
- faz `git merge --ff-only` (ou um merge sem conflito) da branch no repositório principal;
- compila a web;
- dispara o reinício (passo 7) num processo separado (`setsid`).

**7. Reiniciar com verificação: `app/restart.sh`**
- Para o servidor, como no `ui.sh --stop`, e sobe de novo.
- Espera `/api/health` e chama `/api/self-check` (token no header).
- Se falhar em 90 s:
  - volta o repositório principal para `from` com `git reset --hard <from>` (seguro, porque a pré-checagem exigiu árvore limpa);
  - recompila a web e sobe a versão anterior;
  - marca `update.json` com `{ rolledBack: true, error }`.
- Tudo vai para o `server.log`.

**8. `/api/self-check` (servidor novo)** roda verificações com tempo limite e devolve `{ ok, checks: [{ name, ok, ms, error? }] }`:

| Verificação | O que confere |
| --- | --- |
| `catalogo` | `buildOverview` responde |
| `ferramentas` | `createJarvisServer` monta todas as ferramentas, e cada uma tem entrada em `COMMANDS` |
| `voz` | o worker sobe e o TTS sintetiza "ok" |
| `transcricao` | o STT configurado (local ou Groq) transcreve esse áudio sintetizado e reconhece a palavra |
| `cerebro` | uma pergunta mínima ao Claude ("responda só ok") volta em até 20 s |
| `web` | `dist/index.html` existe e é mais novo que o merge |

**9. Anúncio de volta**
- Quando a voz reconecta e há um `update.json` não anunciado, o Jarvis fala, por exemplo: "Atualização aplicada com sucesso: agora eu <resumo>. Verifiquei a voz, a transcrição, o cérebro e as ferramentas: está tudo funcionando." Depois marca o update como anunciado.
- Se houve rollback: "A atualização falhou na verificação de <check> e voltei para a versão anterior; está tudo funcionando como antes. Quer que eu peça a correção?". Um "sim" cria uma proposta nova com o erro, que passa pelos mesmos dois OKs.
- Uma verificação opcional que falhar (por exemplo, `transcricao` sem internet usando o Groq) não causa rollback: o Jarvis só a cita.

**Outras ferramentas:** `descartar_evolucao()` apaga o clone e a branch.

### Fora do escopo
- Aplicar sozinho sem o "ok".
- Várias evoluções em paralelo: uma por vez; uma segunda pede para terminar ou descartar a primeira.

## 2. Memória do Jarvis entre sessões

### Objetivo
O Jarvis guarda o que aprende sobre o usuário, os projetos e as conversas, e usa isso nas próximas sessões, mesmo depois
de reiniciar.

### Armazenamento
- `~/.config/llm-agent/ui/jarvis-memory.json` (0600): `{ facts: Fact[], conversations: Summary[] }`.
- `Fact = { id, about: 'usuario' | 'projeto' | 'preferencia' | 'pessoa' | 'outro', project?: string, text, created, updated }`.
  - Limite de 300; ao passar, saem os mais antigos não atualizados.
- `Summary = { at, text }`, com as últimas 20 conversas (uma frase cada).

### Ferramentas
| Ferramenta | O que faz |
| --- | --- |
| `lembrar({ fato, sobre, projeto?, substitui? })` | Guarda o fato; `substitui` (id) atualiza um fato antigo, por exemplo quando uma preferência mudou |
| `esquecer({ trecho })` | Apaga os fatos que contêm o trecho e diz quantos apagou |
| `o_que_voce_lembra({ sobre?, projeto? })` | Lista os fatos, para "o que você sabe sobre mim?" |
| `encerrar_conversa({ resumo })` | Já existe; ganha `resumo`, uma frase sobre o que foi feito, guardada em `conversations` |

### Uso pelo cérebro
- **Na abertura da sessão do Claude**, o system prompt recebe, além das memórias dos agentes que já entram hoje:
  - "O que você lembra (memória do Jarvis)": os fatos com o id, agrupados por assunto;
  - "Últimas conversas": as 5 mais recentes, com a data.
- **Instruções do `JARVIS_PROMPT`:**
  - Guardar sem anunciar o que for duradouro: nome, preferências, rotina, pessoas, metas e decisões de projetos, stack e prazos. Não guardar o efêmero (clima, a hora, pedidos únicos).
  - Quando o usuário pede explicitamente ("lembra que…"), confirmar com "Anotado."
  - Corrigir um fato existente com `substitui`, em vez de duplicar.
  - Usar a memória com naturalidade ("da última vez você estava nos testes do meu-app"), sem recitar a lista.
- **Ao dormir por silêncio** (sem despedida), o resumo também é pedido: a sessão manda ao cérebro um turno interno e silencioso: "registre o resumo desta conversa com encerrar_conversa".

### Interface
- O painel **Você** ganha a seção "O Jarvis lembra", com os fatos agrupados e um botão para apagar cada um.
- Rotas autenticadas como as demais: `GET /api/jarvis/memory` e `DELETE /api/jarvis/memory/:id`.

### Privacidade
- Tudo fica local, no arquivo 0600.
- O conteúdo vai para o Claude como parte do prompt, como já acontece com as memórias dos agentes.
- "Esquece tudo sobre mim" apaga os fatos `usuario` e `preferencia`, depois de confirmar.

## Testes
- **Servidor:**
  - armazenamento da memória: limite, substituição e esquecimento;
  - ferramentas novas no contexto falso;
  - prompt com memória e conversas;
  - `rascunhar_evolucao`, `resumir_evolucao`, `iniciar_evolucao` (recusa sem OK em turno anterior), `aplicar_evolucao` e `descartar_evolucao` com git real em repositórios temporários: clone, pré-checagens, recusa com árvore suja, aviso de sessões;
  - `/api/self-check` com worker e cérebro falsos;
  - anúncio pós-update e pós-rollback na sessão de voz.
- **`tests/restart.test.sh`:** servidor falso que falha no self-check provoca o rollback e a volta ao commit anterior.
- **Web:** seção "O Jarvis lembra".
