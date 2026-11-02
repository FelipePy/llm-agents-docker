# Comandos por voz do Jarvis (etapa 3b)

Data: 2026-11-02
Status: aprovado (conversa com o usuário)

- **Ferramentas** em processo (Agent SDK `createSdkMcpServer`, servidor `jarvis`), únicas ações do cérebro (`tools: []` desliga as nativas; `allowedTools` lista só as do Jarvis): `abrir_area`, `abrir_projeto`, `abrir_conversas`, `voltar`, `estado_do_projeto`, `iniciar_sessao` (sessão em background com a tarefa como primeira mensagem), `sessoes_abertas`, `estado_da_sessao` (últimas linhas do terminal, sem ANSI), `criar_skill`, `registrar_sobre_mim`, `criar_projeto`, `manual_do_app` (busca por seções no README) e `comandos`.
- **Interface**: o servidor manda `{ type: 'ui', command }` pelo `/ws/voice` (`nav` para um nível, `back`, `focus-session`, `commands`); a UI aplica com as mesmas ações dos cliques. A lista `COMMANDS` (`app/server/src/voice/commands.ts`) alimenta o painel "Comandos de voz", as instruções do cérebro e os testes (cada comando tem uma ferramenta).
- **Sem frases prontas**: despedida, erros e avisos de ação saem do próprio modelo; erros do cérebro aparecem só na legenda.
- **Conhecimento do app**: o cérebro consulta `manual_do_app` antes de responder dúvidas sobre o app.
- **Interrupção falando por cima**: enquanto o Jarvis fala, o worker continua ouvindo com critério mais exigente (VAD ≥ 0,7 por 4 quadros); ao detectar fala, a resposta atual é calada (não abortada: ferramentas terminam em background) e a nova pergunta é respondida depois dela. `LLM_AGENT_VOICE_BARGE_IN=0` desliga.
- **Latência**: pensamento estendido desligado no cérebro; sessão aberta já ao ligar a escuta (`warm`).
- **Sons de clique**: efeitos sintetizados em botões, cartões, abas e planetas; opção "Sons".
