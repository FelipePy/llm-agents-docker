# llm-agents-docker + Jarvis

Guia para agentes trabalhando neste repositório, inclusive a sessão que o próprio Jarvis abre para desenvolver uma
funcionalidade nova nele mesmo (`aplicar_evolucao`). Textos para o usuário são sempre em **português do Brasil**.

## Partes

| Pasta | O que é |
| --- | --- |
| `llm-agent`, `install.sh`, `Dockerfile`, `docker-compose.yml` | CLI que roda Claude Code / Codex num container por projeto. |
| `app/ui.sh` | `llm-agent ui`: sobe, reaproveita e para o servidor da interface (porta 7777, `~/.config/llm-agent/ui`). |
| `app/restart.sh` | Reinício verificado depois de uma evolução, com volta à versão anterior se falhar. |
| `app/server` | Servidor Node 24 (TypeScript executado direto, sem build): API, terminais (PTY), voz e evolução. |
| `app/web` | Interface React + Three.js (Vite): cartões, gaveta de terminais, globo do Jarvis, configurações. |
| `app/voice` | Worker Python da voz: palavra de ativação, detecção de fala, transcrição (whisper local ou Groq), voz (edge-tts). |
| `app/desktop` | App Tauri (Windows/Linux) em volta da interface. Mudanças aqui só valem com um instalador novo (CI). |

### Servidor (`app/server/src`)
- `server.ts`: rotas HTTP (`/api/*`, com token e Origin), WebSocket dos terminais (`/ws`) e da voz (`/ws/voice`), `/api/self-check`.
- `main.ts`: monta tudo com os caminhos reais (estado em `~/.config/llm-agent/ui`).
- `voice/session.ts`: a conversa por voz (estados, interrupção, continuação, ditado). `voice/brain.ts`: o cérebro (Claude
  Haiku pelo Agent SDK) e o `JARVIS_PROMPT`. `voice/tools.ts`: as ferramentas do Jarvis (servidor MCP em processo).
  `voice/commands.ts`: a lista de comandos de voz mostrada na interface. `voice/memory.ts`: memória entre sessões.
- `evolution.ts`: funcionalidades novas para o próprio Jarvis (definição, dois OKs, clone, aplicação).
- O Jarvis **não tem shell nem escrita livre**: ele só age pelas ferramentas de `voice/tools.ts`.

## Receita: um comando de voz novo
1. Handler em `jarvisHandlers` (`app/server/src/voice/tools.ts`), devolvendo um texto curto para o cérebro falar. Acesso a
   dados e ações novas entra em `JarvisContext` e é implementado em `server.ts`.
2. Registro com `tool(nome, descrição, schema zod, run(h.nome))` em `createJarvisServer`. A descrição diz *quando* usar.
3. Entrada em `COMMANDS` (`voice/commands.ts`) com título e exemplos falados. O teste exige uma entrada por ferramenta.
4. Se o comportamento precisar de orientação, uma linha no `JARVIS_PROMPT` (`voice/brain.ts`): orientações de estilo,
   nunca frases prontas.
5. Testes em `app/server/test/voice-tools.test.ts` (o `ctx()` falso cobre o `JarvisContext`).
6. Uma frase no `README.md` (seção da voz): o Jarvis consulta o README para responder dúvidas sobre o app.

## Verificações (todas precisam passar)
```bash
npm --prefix app/server ci && npm --prefix app/web ci   # se faltar node_modules
npm --prefix app/server test
npm --prefix app/server run typecheck
npm --prefix app/web test
npm --prefix app/web run typecheck
npm --prefix app/web run build
python3 -m unittest discover -s app/voice/tests -t app/voice   # se mexer no worker (usa o .venv de app/voice)
bash tests/ui.test.sh && bash tests/restart.test.sh             # se mexer em app/ui.sh ou app/restart.sh
```

## Regras
- Commits pequenos, com testes, mensagem em inglês no imperativo. Sem push (quem aplica é o usuário, pelo Jarvis).
- Siga os padrões do código ao redor; comentários em português sem acento, como no resto do código.
- Nada de chaves, tokens ou dados pessoais em arquivos versionados.
- Não mexa em `app/desktop` sem necessidade (exige instalador novo) e avise no resumo quando mexer.
- Pastas `.jarvis/` (resumo e especificação da evolução) não são versionadas.
