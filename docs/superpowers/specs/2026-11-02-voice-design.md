# Voz do Jarvis (etapa 3a)

Data: 2026-11-02
Status: aprovado

## Contexto

Terceira etapa do assistente estilo "Jarvis" sobre o `llm-agent`, dividida em duas partes:

- **3a. Voz** (este spec): palavra de ativação, conversa contínua até "tchau", transcrição, voz sintetizada e o núcleo (átomo) reagindo ao volume real da fala. O cérebro só conversa.
- **3b. Comandos**: ferramentas do cérebro (abrir projeto na interface, ler o estado de um projeto, disparar e acompanhar sessões em background).

Depende do app (etapa 2, marcos 1 e 2): servidor `app/server`, UI `app/web`, sinal do núcleo `{ mode, level }` e painel do dia.

## Decisões

- **Tudo gratuito.** Palavra de ativação e transcrição locais (openWakeWord e faster-whisper); voz pelo edge-tts (vozes neurais da Microsoft, sem chave; precisa de internet).
- **Palavra de ativação:** "Hey Jarvis" (modelo pronto do openWakeWord).
- **Cérebro:** Claude via Agent SDK (`@anthropic-ai/claude-agent-sdk`) dentro do servidor, com o login do usuário. Segundo a central de ajuda da Anthropic, com o login do plano, o Agent SDK e o `claude -p` consomem os limites normais da assinatura; só usam saldo de API com chave de API. Modelo padrão: Haiku (velocidade), trocável por `LLM_AGENT_VOICE_MODEL`.
- **Sem ferramentas na 3a.** O cérebro não recebe shell, leitura ou escrita de arquivos. Ferramentas próprias e restritas chegam na 3b; trabalho pesado sempre em sessões isoladas no container.
- **Microfone no navegador** (funciona igual no app Tauri depois); o áudio vai ao servidor por WebSocket.

## Arquitetura

```
Navegador / app                       WSL
┌────────────────────────────┐        ┌───────────────────────────────────────────┐
│ microfone (cancelamento de │  PCM   │ Servidor Node                             │
│ eco, 16 kHz) ──────────────┼───────►│  └ VoiceSession (orquestrador)            │
│                            │  /ws/  │      ├─ worker Python (processo filho):   │
│ toca a voz ◄───────────────┼─voice──┤      │   openWakeWord · VAD ·             │
│  └ analisador de volume    │        │      │   faster-whisper · edge-tts        │
│     → núcleo (nível real)  │ eventos│      └─ Brain: Agent SDK (sem tools)      │
│ legendas: você / Jarvis    │        │                                           │
└────────────────────────────┘        └───────────────────────────────────────────┘
```

| Peça | Onde | Responsabilidade |
| --- | --- | --- |
| Captura | `app/web/src/voice/` | `getUserMedia` com cancelamento de eco e supressão de ruído; reamostragem para 16 kHz mono PCM 16 bits num AudioWorklet; envio em quadros de 80 ms. |
| Reprodução | `app/web/src/voice/` | Fila de frases (MP3), tocadas em sequência via Web Audio; `AnalyserNode` gera o nível (0–1) que alimenta o núcleo. Corta tudo ao receber `stop`. |
| Canal | `GET /ws/voice?token=` | Binário: quadros PCM do navegador. Texto (JSON): eventos e comandos nos dois sentidos. Mesmo token e checagem de `Origin` do `/ws`. Uma sessão de voz por vez (uma segunda conexão substitui a anterior). |
| Orquestrador | `app/server/src/voice/session.ts` | Máquina de estados da conversa; liga worker, cérebro e navegador. Testado com worker e cérebro falsos. |
| Worker | `app/voice/` (Python ≥ 3.10) | Processo filho do servidor. Recebe PCM e comandos; emite eventos (`wake`, `speech-start`, `transcript`, `audio`, `ready`, `error`). |
| Cérebro | `app/server/src/voice/brain.ts` | Agent SDK em streaming, sem ferramentas, com instruções de assistente de voz; mantém o contexto entre falas (mesma sessão) até o servidor reiniciar. |

## Worker de voz (Python)

- Ambiente em `app/voice/.venv`, criado pelo servidor na primeira vez que a escuta é ligada (`python3 -m venv` + `pip install -r requirements.txt`), com versões fixadas: `openwakeword==0.6.0`, `faster-whisper==1.2.1`, `edge-tts==7.3.1`. Precisa de `python3` ≥ 3.10 com `venv` no host. Os modelos (openWakeWord, Silero VAD do openWakeWord, whisper) são baixados no primeiro uso para o cache padrão de cada biblioteca.
- **Protocolo com o servidor:** stdin e stdout com mensagens enquadradas: 1 byte de tipo (`A` = áudio PCM, `J` = JSON) + 4 bytes de tamanho (big-endian) + conteúdo. stderr vai para o log do servidor.
- **Comandos (JSON):** `{"cmd":"listen"}` (passa a segmentar falas), `{"cmd":"sleep"}` (volta a só esperar a palavra de ativação), `{"cmd":"speak","id":N,"text":"..."}` (sintetiza e devolve o áudio), `{"cmd":"cancel"}` (descarta sínteses pendentes).
- **Eventos (JSON):** `ready`, `wake` (score), `speech-start`, `transcript` (`text`, `id`), `audio` (`id`, MP3 em base64, `last`), `error` (`message`).
- **Palavra de ativação:** sempre ativa (inclusive enquanto o Jarvis fala, para permitir interrupção); limiar padrão 0,5 (`LLM_AGENT_VOICE_WAKE_THRESHOLD`); ignora novas detecções por 2 s após uma detecção.
- **Segmentação (modo `listen`):** VAD Silero (do openWakeWord) por quadro de 80 ms; a fala começa com 2 quadros seguidos acima de 0,5 e termina com 0,8 s abaixo; descarta segmentos com menos de 0,3 s; corta segmentos com mais de 30 s. Guarda 0,3 s antes do início para não perder a primeira sílaba.
- **Transcrição:** faster-whisper, `language="pt"`, modelo `LLM_AGENT_VOICE_STT_MODEL` (padrão `small`), CUDA quando disponível, senão CPU `int8`. Roda numa thread para não bloquear a leitura do áudio.
- **Síntese:** edge-tts com a voz `LLM_AGENT_VOICE` (padrão `pt-BR-AntonioNeural`), uma frase por comando `speak`.

## Orquestrador

Estados: `off` (escuta desligada), `sleeping` (só palavra de ativação), `listening`, `thinking`, `speaking`. O estado vira o `mode` do núcleo (`off` e `sleeping` → `idle`).

| De | Evento | Para | Ações |
| --- | --- | --- | --- |
| `off` | navegador liga a escuta | `sleeping` | inicia o worker (se preciso), `sleep` |
| `sleeping` | `wake` | `listening` | `listen`; som curto de ativação no navegador |
| `listening` | `transcript` vazio | `listening` | nada |
| `listening` | `transcript` de despedida | `speaking` → `sleeping` | fala "Até mais!" (sem o cérebro); ao terminar, `sleep` |
| `listening` | `transcript` | `thinking` | legenda do usuário; envia ao cérebro |
| `thinking` | primeira frase do cérebro | `speaking` | `speak` frase a frase, na ordem; legenda do Jarvis cresce |
| `speaking` | navegador termina de tocar tudo e o cérebro acabou | `listening` | `listen` |
| `thinking`/`speaking` | `wake` ou `Esc` no navegador | `listening` | aborta o cérebro, `cancel`, `stop` no navegador |
| qualquer | navegador desliga a escuta ou desconecta | `off` | aborta tudo, `sleep` |

- **Silêncio não encerra:** em `listening`, sem fala, ele espera indefinidamente.
- **Despedida:** a transcrição, normalizada (minúsculas, sem acentos e pontuação), é exatamente uma destas: "tchau", "tchau jarvis", "ate mais", "ate logo", "ate mais jarvis", "obrigado tchau", "valeu tchau".
- **Frases:** o texto em streaming é cortado em frases em `.`, `!`, `?` ou `…` seguidos de espaço ou fim, ou em quebra de linha; o resto sai quando o cérebro termina. Markdown é removido antes da síntese (`*`, `_`, `#`, crases, links viram só o texto).
- **O worker não segmenta a fala do próprio Jarvis:** em `speaking`, o worker fica em `sleep` (só palavra de ativação, para interrupção); volta a `listen` quando a reprodução termina.

## Cérebro (3a)

- `query()` do Agent SDK em streaming, com `model` (`LLM_AGENT_VOICE_MODEL`, padrão `haiku`), sem ferramentas (`allowedTools: []`, `tools` vazio, sem MCP), instruções próprias (persona) e retomando a mesma sessão a cada fala (`resume`).
- Instruções: assistente de voz chamado Jarvis, em português do Brasil, respostas curtas (1 a 3 frases, salvo pedido), sem markdown, listas ou código; se não souber ou não puder fazer algo nesta versão, diz isso em uma frase.
- O processo do cérebro roda com `cwd` na pasta de trabalho do Jarvis e sem variáveis `ANTHROPIC_*` no ambiente (para nunca trocar o login do plano por uma chave de API sem querer).
- Erros: o Jarvis fala "Tive um problema para responder agora." e mostra o detalhe na legenda.

## Interface

- **Escuta ativa:** interruptor no painel do dia, desligado por padrão e guardado em `localStorage` (`llm-agent-voice`). Ligar pede o microfone; negado, volta para desligado com aviso.
- **Estado do núcleo:** com a escuta ligada, o sinal do núcleo vem da voz real (estado do orquestrador + nível da reprodução); a "Demonstração de voz" só funciona com a escuta desligada.
- **Legendas** abaixo do núcleo: última fala do usuário ("você: …") e a resposta do Jarvis sendo dita; somem 8 s depois que a conversa volta a `sleeping`.
- **Status** no painel do dia: "preparando a voz…" (instalando ou carregando modelos), "diga 'Hey Jarvis'", "ouvindo", etc.; erros do worker aparecem ali.
- `Esc` (fora do terminal), com o Jarvis falando ou pensando, interrompe.

## Erros

- Sem `python3` ≥ 3.10 ou sem `venv`: o painel mostra o que instalar; a escuta desliga.
- Instalação ou download de modelos falhando: mensagem com o fim do log; a escuta desliga.
- Worker cai: o servidor reinicia uma vez; caindo de novo em 60 s, desliga a escuta com aviso.
- edge-tts falha (sem internet): a resposta aparece só na legenda e o ciclo continua.
- Microfone negado ou ausente: aviso e escuta desligada.

## Testes

- **Servidor (node:test):** `VoiceSession` com worker e cérebro falsos: ativação, ciclo contínuo, silêncio sem timeout, despedida, interrupção por `wake` e por `Esc`, erro do cérebro, erro do edge-tts, desconexão; divisão em frases e limpeza de markdown; reconhecimento de despedidas; enquadramento do protocolo do worker; `/ws/voice` recusa token e `Origin` errados.
- **Worker (pytest):** enquadramento do protocolo e segmentador por VAD com uma VAD falsa (início, fim, mínimo, máximo, pré-rolagem). Sem baixar modelos nos testes.
- **UI (vitest):** conversão para PCM 16 bits e reamostragem; nível a partir do analisador.
- **Manual (usuário):** ativação, transcrição em português, voz, interrupção, despedida, átomo reagindo.

## Fora de escopo (3a)

- Ferramentas do cérebro e comandos de interface (3b).
- Atalho global de teclado e microfone com a janela fechada (marco 3, Tauri).
- Palavra de ativação personalizada ("Ei, Claude").

## Revisão: latência (após o primeiro teste do usuário)

O usuário achou a transcrição e a resposta lentas. Mudanças:

- **Fim da fala:** 0,5 s de silêncio (antes 0,8 s), configurável por `LLM_AGENT_VOICE_END_MS`.
- **Legenda ao vivo:** enquanto o usuário fala, o worker transcreve o trecho em andamento a cada ~0,5 s de fala (só quando a transcrição anterior terminou) e emite `partial`; a legenda "você: …" se atualiza a cada pedaço.
- **Cérebro em sessão contínua:** o Agent SDK roda em modo de entrada em streaming (`prompt` como fila assíncrona), com um único processo para todas as falas; interromper usa `interrupt()` e o resto da resposta interrompida é descartado antes da próxima. Erro fecha a sessão; a próxima fala abre outra com `resume`.
- **Voz mais cedo:** o primeiro trecho de cada resposta sai na primeira vírgula, ";" ou ":" depois de 20 caracteres (o resto, por frases). O edge-tts envia o MP3 em pedacos de 4 KB (`audio` com `last`) e o navegador toca com `MediaSource` enquanto chega (sem `MediaSource` para MP3, toca quando a frase chega inteira).
- **Medição:** o servidor registra, por resposta, o tempo de transcrição, do primeiro token e do primeiro áudio.
