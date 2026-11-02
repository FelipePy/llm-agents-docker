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
- **Nomes de projeto**: o whisper recebe os nomes dos projetos como vocabulário (`initial_prompt`); a busca compara nomes sem espaços e hífens, aceita palavras em outra ordem e erros de grafia (trigramas) e, quando dois projetos ficam próximos demais, a ferramenta pede ao cérebro que pergunte qual. O cérebro recebe a lista de projetos nas instruções.
- **Falar com as sessões**: `enviar_para_sessao` digita um recado e envia (Enter separado do texto); `falar_direto_com_sessao` liga a conversa direta, em que as falas vão para o terminal da sessão sem passar pelo cérebro, até "Jarvis, volta" (ou "Hey Jarvis"/despedida). A interface mostra com quem se está falando.
- **Chamado pelo nome**: além do modelo "Hey Jarvis", enquanto espera, o worker transcreve falas de até 8 s e o servidor procura "Jarvis" (e grafias próximas) no começo; "Jarvis, faça X" já executa X. `LLM_AGENT_VOICE_NAME_WAKE=0` desliga.
