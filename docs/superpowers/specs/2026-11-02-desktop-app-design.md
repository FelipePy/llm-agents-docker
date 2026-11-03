# App desktop: núcleo de voz, agentes e conversas

Data: 2026-11-02
Status: aprovado

## Contexto

Este é o segundo de três subprojetos rumo a um assistente estilo "Jarvis" sobre o `llm-agent`:

1. Remote Control automático ao abrir o Claude Code (spec `2026-11-02-remote-control-design.md`).
2. **App desktop** (este spec).
3. Voz: palavra de ativação, conversa contínua até "tchau" e tarefas em background.

O app é um ponto central para todos os projetos. Ele mostra o que os agentes sabem sobre o usuário (instruções globais e memórias), as skills instaladas, os projetos e as conversas de cada um, em cartões dispostos em volta de um núcleo animado que representa a voz do agente. Ele também abre, retoma e alterna sessões do Claude Code, do Codex e de um shell, em terminais embutidos que rodam o `llm-agent` de sempre.

## Decisões

- **Casca:** Tauri 2, nativo no Windows. Sob o WSLg, o WebGL é lento e o microfone (etapa 3) é instável.
- **Interface:** web (React, react-three-fiber, xterm.js), servida pelo servidor local. A mesma UI abre no navegador durante o desenvolvimento.
- **Servidor:** Node e TypeScript no WSL, com o usuário do host, fora do container. Ele lê `~/.claude` e `~/.codex` e abre terminais que executam o `llm-agent`.
- **Terminal embutido** em vez de chat próprio. As sessões continuam interativas e cobertas pelo plano da assinatura, e Claude Code e Codex funcionam exatamente como no terminal.
- **Todos os projetos**, não um por vez.
- **Somente leitura** para memórias, instruções e skills: o app não edita arquivos. Criar skills, registrar informações sobre o usuário e preparar projetos novos é feito por sessões do Claude abertas pelos botões "+".

## Arquitetura

```
Windows                                  WSL2 (usuário do host, fora do container)
┌──────────────────────────────┐         ┌──────────────────────────────────────┐
│ App Tauri                    │  http   │ Servidor (`llm-agent ui`)            │
│ - ao abrir: wsl.exe →        │  + ws   │ - leitores: perfil, skills,          │
│   `llm-agent ui --url`       │◄───────►│   projetos, conversas                │
│ - carrega a URL retornada    │127.0.0.1│ - observa o disco, avisa a UI        │
└──────────────────────────────┘ + token │ - terminais (PTY) → llm-agent        │
                                         └──────────────────────────────────────┘
```

Estrutura no repositório:

| Pasta | Conteúdo |
| --- | --- |
| `app/server` | Servidor HTTP e WebSocket, leitores de dados e gerenciador de terminais. Node ≥ 22.18, TypeScript executado direto pelo Node (type stripping), sem etapa de build. Testes com `node:test`. |
| `app/web` | UI: Vite, React, xterm.js e, no marco 2, three.js e react-three-fiber. Testes com vitest. O build vai para `app/web/dist`, servido pelo servidor. |
| `app/desktop` | Projeto Tauri 2 (marco 3). |
| `.github/workflows/desktop.yml` | Build do instalador do Windows (marco 3). |

Dependências do servidor: `ws` e `@lydell/node-pty`. Este fork do `node-pty` traz binários prontos, então não precisa de compilador C++ no WSL. O `node-pty` original exige `g++` e `make`.

## Comando `llm-agent ui`

- `llm-agent ui`: garante que o servidor está rodando e imprime a URL de acesso (`http://127.0.0.1:<porta>/#token=<token>`).
  - Se `~/.config/llm-agent/ui/server.json` aponta para um processo vivo e `GET /api/health` responde, reaproveita esse servidor.
  - Senão, sobe o servidor em background (`nohup node app/server/src/main.ts`), com log em `~/.config/llm-agent/ui/server.log`, e espera o health responder por até 10 s.
  - Na primeira execução, se faltar `app/server/node_modules` ou `app/web/dist`, roda `npm ci` (e o build da UI) antes, avisando o usuário.
- `llm-agent ui --stop`: encerra o servidor e todas as sessões abertas nele.
- Porta: `LLM_AGENT_UI_PORT`, padrão `7777`.
- O subcomando roda no host. Não chama o Docker e não exige estar dentro de um projeto.

## Dados lidos

Todos os caminhos partem de `$HOME` do usuário. Linhas inválidas em `.jsonl` são ignoradas, e arquivos ilegíveis são pulados sem derrubar a lista.

**Perfil ("Você")**
- Instruções globais: `~/.claude/CLAUDE.md` e `~/.codex/AGENTS.md`, se existirem.
- Memórias do Codex: `~/.codex/memories/MEMORY.md` e `~/.codex/memories/memory_summary.md`, se existirem.
- Memórias do Claude sobre o usuário: os arquivos `~/.claude/projects/*/memory/*.md` cujo frontmatter tem `type: user` (no topo ou dentro de `metadata`), de todos os projetos.
- O conteúdo de cada arquivo é enviado até 64 KB, truncado com aviso.

**Skills**
- `~/.claude/skills/*/SKILL.md` (origem `claude`), `~/.codex/skills/*/SKILL.md` (origem `codex`) e skills de plugins: para cada plugin em `~/.claude/plugins/installed_plugins.json`, `<installPath>/skills/*/SKILL.md` (origem `plugin:<nome>`).
- De cada `SKILL.md` saem `name` e `description` do frontmatter YAML (só campos de uma linha). Sem frontmatter, o nome é o da pasta.
- Symlinks são seguidos.

**Conversas do Claude Code** (`~/.claude/projects/<pasta>/<id>.jsonl`)
- `id`: nome do arquivo sem `.jsonl`.
- `cwd`: o campo `cwd` do primeiro registro que o tiver. É ele que define o projeto, porque o nome da pasta é uma codificação ambígua (`-home-a-b` pode ser `/home/a/b` ou `/home/a-b`).
- `title`: o `aiTitle` do último registro `type: "ai-title"`. Sem ele, o primeiro registro `type: "user"` com `origin.kind == "human"` e `message.content` em texto que não comece com `<`, cortado em 80 caracteres. Sem nenhum dos dois, "(sem título)".
- `updatedAt`: mtime do arquivo. `prompts`: número de registros `user` com `origin.kind == "human"`. Registros de versões antigas, sem `origin`, contam como humanos quando `message.content` é texto e `isMeta` não é verdadeiro.
- A memória do projeto fica em `~/.claude/projects/<pasta>/memory/*.md`, na pasta que contém conversas daquele `cwd`.

**Conversas do Codex** (`~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl`)
- `id` e `cwd`: `payload.id` e `payload.cwd` do registro `type: "session_meta"`.
- `title`: `payload.message` do primeiro registro `type: "event_msg"` com `payload.type == "user_message"`, cortado em 80 caracteres. Sem ele, "(sem título)".
- `updatedAt`: mtime. `prompts`: número desses `user_message`.

**Projetos**
- Um projeto é um `cwd` distinto entre todas as conversas, cujo diretório ainda existe e não é `$HOME` nem `/`.
- `id`: o caminho em base64url. `name`: o último componente do caminho. `updatedAt`: a conversa mais recente.
- Detalhe do projeto: conversas dos dois agentes, mais recentes primeiro; arquivos de memória do Claude; `CLAUDE.md` e `AGENTS.md` da raiz do projeto; branch atual e se há mudanças (`git status --porcelain`), quando for repositório git.

Os leitores observam `~/.claude/projects`, `~/.codex/sessions` e as pastas de skills com `fs.watch` recursivo e mandam `{"type":"changed"}` pelo WebSocket, agrupando eventos por 500 ms.

## API

Todas as rotas `/api/*`, exceto `/api/health`, exigem `Authorization: Bearer <token>`.

| Rota | Resposta |
| --- | --- |
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/overview` | `{ profile, skills, projects, conversations }` (projetos em resumo: `id`, `name`, `path`, `updatedAt`, `conversations`, `agents`; `conversations` são todas as conversas, mais recentes primeiro, usadas pela busca global) |
| `GET /api/projects/:id` | detalhe do projeto (ver "Projetos") |
| qualquer outra rota | arquivos estáticos de `app/web/dist`, com fallback para `index.html` |

WebSocket em `/ws?token=<token>` (navegadores não mandam cabeçalhos no WebSocket). Mensagens em JSON:

| Direção | Mensagem |
| --- | --- |
| cliente → servidor | `open { projectPath, agent: "claude" \| "codex" \| "shell", resume?, cols, rows }` |
| | `attach { id }`, `input { id, data }`, `resize { id, cols, rows }`, `close { id }` |
| servidor → cliente | `sessions { sessions: [{ id, projectPath, agent, resume?, title, startedAt, alive }] }`, enviado na conexão e a cada mudança |
| | `opened { session }`, `output { id, data }`, `history { id, data }` (resposta ao `attach`), `exit { id, code }`, `changed {}`, `error { message }` |

## Terminais

- Cada sessão é um PTY (`xterm-256color`) que executa `<repo>/llm-agent <args>` com `AGENT_WORKDIR=<projectPath>` e `cwd=<projectPath>`.
- Argumentos, no modo autônomo do menu atual:

| Agente | Nova | Retomar |
| --- | --- | --- |
| claude | `claude --dangerously-skip-permissions` | `claude --dangerously-skip-permissions --resume <id>` |
| codex | `codex --dangerously-bypass-approvals-and-sandbox` | `codex resume --dangerously-bypass-approvals-and-sandbox <id>` |
| shell | `zsh` | — |

- O Claude sobe com Remote Control porque o `llm-agent` acrescenta a flag (etapa 1).
- O servidor guarda os últimos 1 MB de saída de cada sessão. No `attach`, responde com `history`, e a UI limpa o terminal antes de escrevê-lo. Assim as sessões sobrevivem a fechar e reabrir a janela.
- Quando o processo termina, a sessão fica marcada como `alive: false` até o usuário fechar a aba.
- `llm-agent ui --stop` ou o fim do servidor encerram os PTYs. As conversas continuam retomáveis por `--resume`.
- `LLM_AGENT_BIN` substitui o caminho do `llm-agent` (usado nos testes).

## Interface

**Marco 1: funcional, sem 3D**
- Barra lateral com "Você", "Skills" e a lista de projetos (mais recentes primeiro, com busca por nome).
- Painel "Você": instruções globais e memórias, em markdown renderizado com `react-markdown`, sem HTML bruto (os arquivos podem ter sido escritos por agentes).
- Painel "Skills": lista com filtro por origem e busca. Clicar mostra a descrição.
- Painel do projeto: caminho, branch e estado do git; botões "Claude", "Codex" e "Shell" para nova sessão; conversas com ícone do agente, título, data e botão "Retomar"; memória e instruções do projeto.
- Gaveta de terminais na parte de baixo, redimensionável, com abas (`projeto · agente · título`). Atalhos: `Ctrl+Tab` e `Ctrl+Shift+Tab` alternam, `Ctrl+1..9` vão para a aba N e `Ctrl+Shift+W` fecha. Sessões encerradas mostram "encerrada" e a opção de reabrir.
- `Ctrl+K` (com o foco fora do terminal, onde o atalho apaga a linha no shell): busca global por projetos, conversas e skills.
- Sem conexão, aparece "reconectando" e a UI tenta de novo com espera crescente até 10 s.

**Marco 2: núcleo de voz, cartões à direita e painel do dia**

Revisado duas vezes depois de avaliações do usuário. A primeira versão (buraco negro com projetos em órbita) exigia cliques em corpos pequenos e em movimento. A segunda (átomo azul com cartões em elipse) ficou com o núcleo pouco "vivo" e os cartões espalhados.

- **Núcleo (átomo dourado), sempre no centro da área à esquerda dos cartões:** um aglomerado de prótons (dourados) e nêutrons (âmbar claros) e três órbitas elípticas inclinadas com um elétron e rastro cada, em tons de amarelo. Câmera fixa (gira levemente; sem zoom nem deslocamento). Sem halo nem brilho extra ao falar.
- **Voz como temperatura:** o sinal `{ mode, level }` vira um "calor" de 0 a 1 (suavizado: esquenta rápido, esfria devagar). Frio (`idle`): núcleo quase parado, órbitas estáveis. Quente (`speaking`, conforme o volume; `thinking` e `listening` mornos): prótons e nêutrons vibram, as órbitas tremem, se deformam e precessionam, e os elétrons aceleram. A cor da órbita varia dentro do amarelo conforme o estado. A opção "Demonstração de voz" percorre os estados com um sinal sintético até a etapa 3.
- **Cartões à direita:** o conteúdo da área atual fica numa coluna em arco à direita do átomo, de cima para baixo, com espaçamento vertical uniforme. Cartão compacto: ponto de cor, nome e, nos cartões do início, a contagem. Detalhes aparecem ao clicar. Cabem de 6 a 18 por página, conforme a altura da tela, com setas de página e campo de filtro nas listas.
- **Níveis:** Início (Você · Projetos · Skills · Sessões abertas) → Você (instruções e memórias, uma por cartão) · Projetos (um cartão por projeto) → Projeto (Sobre o projeto · Conversas · Memória · Instruções · git · + Claude · + Codex · + Shell) → Conversas (clicar retoma) · Skills · Sessões abertas (clicar foca a aba).
- **Botões "+" pelo agente:** "+ Sobre mim" (em Você) e "+ Nova skill" (em Skills) abrem uma sessão do Claude, já com a instrução da tarefa, numa pasta de trabalho própria (`${XDG_DATA_HOME:-~/.local/share}/llm-agent/workspace`, fora da lista de projetos). "+ Novo projeto" pede só o nome; o servidor cria a pasta na pasta-base de projetos e abre o Claude nela, instruído a preparar o projeto com o usuário. A pasta-base é `LLM_AGENT_PROJECTS_DIR` ou a pasta-mãe mais comum entre os projetos conhecidos (sem projetos: `~/projetos`). "+ Nova sessão" (em Sessões abertas) leva à lista de projetos.
- **Painel do dia (coluna esquerda no modo 3D, no lugar do menu):** data e hora (atualizadas a cada segundo), clima (temperatura atual, descrição, máxima e mínima) e as principais notícias do dia, com links. As opções (Modo 3D, Reduzir movimento, Demonstração de voz) ficam no pé do painel. O menu lateral continua no modo lista.
- **Leitura:** detalhes (projeto, arquivo de memória ou instrução, skill, formulário de novo projeto) abrem num painel à esquerda da área central. `Esc` fecha o painel ou sobe um nível. Trilha clicável no topo. `Ctrl+K` salta para projetos, conversas e skills.
- **Modelo de navegação puro** (`push`, `back`, `goto`, `jump`, `page`, `filter`), para a etapa 3 controlar a interface por voz.
- Gaveta aberta escurece a cena. "Reduzir movimento" congela rotação e órbitas e atenua a agitação. "Modo 3D" desligado ou sem WebGL 2: interface do marco 1. Qualidade automática: 3 segundos abaixo de 30 FPS desligam o bloom; mais 3 reduzem a malha das partículas.

**Dados do painel do dia (servidor)**
- `GET /api/day?lat=&lon=` (com token) devolve `{ weather, weatherError?, news, newsError? }`.
- Clima: Open-Meteo (sem chave). Coordenadas vêm da geolocalização do navegador; sem elas, da cidade em `LLM_AGENT_UI_CITY` (geocodificação do Open-Meteo); sem nenhuma, `weather: null` e uma mensagem explicando. Cache de 15 minutos.
- Notícias: RSS do Google Notícias em português (`LLM_AGENT_UI_NEWS_RSS` troca a fonte), até 8 itens, só links `http(s)`. Cache de 30 minutos.
- Falhas de rede viram `weatherError`/`newsError`; uma não derruba a outra. Tempo limite de 5 segundos por requisição.
- O clima envia as coordenadas ao Open-Meteo; o README avisa.

**Mensagens novas no WebSocket**
- `task { task: "new-skill" | "about-me", cols, rows }`: abre o Claude na pasta de trabalho com a instrução da tarefa (o texto fica no servidor; o cliente só escolhe a tarefa).
- `create-project { name, cols, rows }`: `name` com até 64 caracteres entre letras, números, `.`, `_` e `-`, começando por letra ou número. Recusa se a pasta já existir.
- `open` também aceita a pasta de trabalho (para reabrir uma sessão de tarefa).
- A instrução inicial vai como último argumento do `claude`.

**Marco 3: Tauri**
- Ao abrir, o app executa `wsl.exe -e bash -lc "llm-agent ui"`, lê a URL da última linha da saída e carrega essa URL na janela.
- Se o comando falhar, mostra a saída de erro e o comando para rodar à mão.
- O instalador (`.msi`) é gerado no GitHub Actions (`windows-latest`) a cada tag `desktop-v*` e publicado como release.

## Segurança

O servidor consegue abrir agentes autônomos, então:
- escuta só em `127.0.0.1`;
- usa um token de 32 bytes aleatórios, gerado na primeira execução e salvo em `~/.config/llm-agent/ui/token` com permissão `600`. Comparação em tempo constante;
- recusa (403) requisições HTTP e WebSocket com cabeçalho `Origin` diferente de `http://127.0.0.1:<porta>` e `http://localhost:<porta>`, além das origens extras em `LLM_AGENT_UI_ORIGINS` (separadas por vírgula; usado pelo servidor de desenvolvimento do Vite). Requisições sem `Origin` passam, desde que tenham o token;
- a UI lê o token do fragmento da URL (`#token=`), que não é enviado em requisições nem em `Referer`, guarda-o em `sessionStorage` e remove o fragmento da barra de endereço.

## Erros

- `llm-agent` falhando (Docker parado, imagem ausente): a saída aparece no terminal da aba e a sessão fica "encerrada".
- `.jsonl` corrompido ou arquivo ilegível: ignorado.
- `projectPath` de um `open` que não está na lista de projetos conhecidos: `error`. Isso impede abrir agentes em pastas arbitrárias, como a home.
- `resume` de um `open` que não é uma conversa conhecida do mesmo agente e do mesmo projeto: `error`. Isso impede injetar argumentos no `llm-agent`.
- Porta ocupada por outro programa: `llm-agent ui` mostra o erro do log e sugere `LLM_AGENT_UI_PORT`.

## Testes

- Servidor (`node --test`): leitores com uma `$HOME` falsa de fixtures, incluindo linhas inválidas, caminhos com hífen, conversa sem título e projeto apagado; autenticação (sem token, token errado, `Origin` estranho no HTTP e no WebSocket); terminais com um `llm-agent` falso (`LLM_AGENT_BIN`): argumentos corretos, histórico no `attach`, `exit`, recusa de projeto desconhecido.
- `llm-agent ui`: teste em bash no estilo de `tests/remote-control.test.sh`, com servidor real numa porta livre e `HOME` falsa (sobe, reaproveita e `--stop`).
- UI (vitest): cliente da API (token, reconexão) e lógica das abas (atalhos, ordem, fechar).
- Manual: visual do marco 2 e app do marco 3.

## Ordem de entrega

1. **Marco 1:** servidor, `llm-agent ui` e UI funcional sem 3D. Já é usável no navegador.
2. **Marco 2:** núcleo de voz (átomo), cartões à direita e painel do dia.
3. **Marco 3:** app Tauri e build no GitHub Actions.

Cada marco tem o seu plano de implementação, escrito quando o anterior terminar.

## Fora de escopo

- Voz (etapa 3).
- Editar memórias, instruções ou skills pelo app.
- App desktop para macOS e Linux.
- Acesso ao app pelo celular. O celular usa o Remote Control.

## Revisão do marco 2 (depois da etapa 3a)

A pedido do usuário, o núcleo volta a ser o **buraco negro** (o átomo sai, sem opção de escolha):

- O buraco negro é a voz do Jarvis: o mesmo sinal `{ mode, level }` vira calor (disco mais turbulento e mais rápido) e o volume da fala se projeta no disco como ondas que saem do centro.
- Projetos voltam a orbitar como planetas e skills como cinturão de estrelas; a coluna de cartões à direita continua sendo a navegação principal. A câmera fica sempre apontada para o centro (gira e aproxima dentro de limites, sem voar até os planetas). Clicar num planeta faz o mesmo que o cartão do projeto; o projeto em foco mostra as conversas como luas (clicar retoma).
- Configuração **Planetas** (`llm-agent-planets`, ligada por padrão): esconde planetas e estrelas.

## Marco 3 implementado (Tauri)

- `app/desktop`: projeto Tauri 2. A janela abre numa tela local ("Iniciando o servidor no WSL…"), executa `wsl.exe -e bash -lc "llm-agent ui"` (com `~/.local/bin` no PATH, sem console visível; `JARVIS_WSL_DISTRO` escolhe a distribuição), lê a URL da saída e navega até ela. Falha: volta à tela local com o erro e "Tentar de novo".
- WebView2 com `--autoplay-policy=no-user-gesture-required` (a voz toca sem clique) e `--use-fake-ui-for-media-stream` (microfone liberado).
- Bandeja (mostrar, reiniciar o servidor, sair), fechar esconde a janela, atalho global `Ctrl+Alt+J`, instância única.
- Só a tela local tem acesso ao Tauri (capacidade `default`); a interface remota do llm-agent não.
- `.github/workflows/desktop.yml`: compila em `windows-latest` a cada mudança em `app/desktop` (push e PR), publica artefatos e, em tags `desktop-v*`, um release com `.msi` e `.exe`. Ícones gerados de `src-tauri/app-icon.png` (`tauri icon`).
