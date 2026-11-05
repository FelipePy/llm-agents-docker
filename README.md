# Jarvis

Rode agentes de código LLM — **Claude Code** e **Codex** — dentro de um container Docker que enxerga **apenas o projeto em que você está trabalhando**.

Agentes como esses costumam ser usados em modo autônomo (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`). Rodá-los no container limita o estrago possível: o agente pode editar o projeto montado, mas não o resto da sua home, outros projetos ou o sistema.

## Recursos

- Imagem única com Claude Code e Codex (versões fixadas e configuráveis).
- Usa o **mesmo login e configuração** dos CLIs no host (`~/.claude`, `~/.claude.json`, `~/.codex`) — nada de logar de novo.
- **Histórico de chats compartilhado** com o host: um chat iniciado fora do container pode ser retomado dentro dele (e vice-versa) com `claude --resume`.
- **Remote Control ligado por padrão**: toda sessão do Claude Code aparece no app Claude do celular e em claude.ai/code.
- Usuário do container com o mesmo UID/GID do seu usuário, então os arquivos criados pertencem a você.
- Repassa, se existirem no host: SSH agent, `~/.ssh`, `gh`, `~/.gitconfig`, `~/.zshrc`/oh-my-zsh, nvm, pyenv, bun e `~/.local/bin`.
- Container sem capabilities (`cap_drop: ALL`) e com `no-new-privileges`.
- **Interface gráfica** (`jarvis ui`): perfil, skills, projetos e conversas de todos os seus projetos, com terminais embutidos para abrir, retomar e alternar sessões do Claude Code, do Codex e do shell.

## Requisitos

- Linux (ou WSL2) com Docker e o plugin `docker compose` v2.
- Uma conta do Claude e/ou da OpenAI para os respectivos CLIs.

## Instalação

```sh
git clone https://github.com/FelipePy/llm-agents-docker.git
cd llm-agents-docker
./install.sh
```

O instalador:

1. verifica se o Docker e o `docker compose` estão disponíveis;
2. cria o comando `jarvis` (e `llm-agent`, o nome antigo, que o app desktop usa) em `~/.local/bin` (um link para o script deste repositório; use `LLM_AGENT_BIN_DIR` para outro destino);
3. constrói a imagem com o seu UID/GID;
4. avisa se `~/.local/bin` não estiver no seu `PATH`.

Para desinstalar: `./install.sh --uninstall`.

### Servidores onde só outro usuário acessa o Docker

Se o seu usuário não acessa o Docker, mas pode rodá-lo como outro usuário (por exemplo, `sudo -u dockeruser docker`), instale **com o seu próprio usuário** e informe o comando do Docker:

```sh
./install.sh --docker "sudo -u dockeruser docker"
```

O valor fica salvo em `~/.config/llm-agent/config` e passa a ser usado em toda chamada ao Docker. O resto continua sendo seu: o comando fica no seu `~/.local/bin`, e os agentes usam a sua home, o seu UID, as suas credenciais e os seus projetos. Os arquivos que o agente cria pertencem a você.

Requisitos:

- **Leitura do repositório:** o outro usuário precisa conseguir ler a pasta deste repositório, porque o `docker compose` lê o `Dockerfile` e o `docker-compose.yml` como ele. Se a sua home for fechada para outros usuários, clone o projeto em um lugar acessível, como `/opt/llm-agents-docker`.
- **Senha do sudo:** o `sudo` pode pedir a sua senha ao abrir um agente, conforme a configuração do servidor.

Também funciona com `--docker "sudo docker"`. Para trocar o comando, rode o `./install.sh --docker ...` de novo. Para um uso pontual, defina `LLM_AGENT_DOCKER`.

## Uso

Entre na pasta do projeto e rode `jarvis`. Um menu pergunta qual agente abrir:

```console
$ cd ~/projetos/meu-app
$ jarvis
Qual agente abrir em /home/voce/projetos/meu-app?
  1) Claude Code
  2) Codex
  3) Shell (zsh)
Escolha [1-3]:
```

Pelo menu, os agentes abrem em **modo autônomo** (`claude --dangerously-skip-permissions` e `codex --dangerously-bypass-approvals-and-sandbox`), já que o container limita o que eles conseguem acessar.

Também dá para chamar o agente direto, com os argumentos que quiser:

```sh
jarvis claude                                  # Claude Code pedindo permissões
jarvis claude --dangerously-skip-permissions   # Claude Code autônomo
jarvis codex                                   # Codex com aprovações normais
jarvis claude --model opus                     # Claude Code com outro modelo
jarvis zsh                                     # shell dentro do container
jarvis --help                                  # ajuda
```

Tudo que vem depois de `jarvis` é executado dentro do container, então os argumentos de cada CLI (como `--model`) funcionam normalmente. Para usar outro diretório sem entrar nele:

```sh
AGENT_WORKDIR=~/projetos/meu-app jarvis claude
```

Por segurança, o script se recusa a rodar na sua home ou em `/`, pois isso exporia todos os seus arquivos ao agente.

Cada sessão roda em um container chamado `llm-agent-<comando>-<pasta>`, como `llm-agent-claude-meu-app`, o que facilita identificá-la em `docker ps`. Se você abrir o mesmo agente mais de uma vez no mesmo projeto, as sessões seguintes recebem `-2`, `-3` etc. O container é removido ao sair.

Se você ainda não fez login, faça uma vez (no host ou no container) — o login fica salvo no host e vale para os dois.

### Retomando conversas

O projeto é montado no **mesmo caminho absoluto** do host, então o Claude Code usa a mesma pasta de histórico (`~/.claude/projects/<caminho-do-projeto>`) dentro e fora do container:

```sh
jarvis claude --continue   # retoma o último chat deste projeto
jarvis claude --resume     # escolhe entre os chats deste projeto
```

Evite continuar o mesmo chat no host e no container ao mesmo tempo.

### Usando pelo celular (Remote Control)

Ao abrir o Claude Code, o `jarvis` liga o Remote Control: a sessão aparece no app Claude do celular e em [claude.ai/code](https://claude.ai/code), e você pode continuar a conversa por lá enquanto o agente roda no seu computador.

A sessão recebe o nome do container sem o prefixo `llm-agent-`, como `claude-meu-app` (ou `claude-meu-app-2` numa segunda sessão no mesmo projeto). Sessões abertas ao mesmo tempo recebem números diferentes: cada nome é reservado com um lock em `~/.config/llm-agent/locks` enquanto a sessão estiver aberta.

```sh
jarvis claude --remote-control outro-nome   # escolhe outro nome
LLM_AGENT_NO_REMOTE_CONTROL=1 jarvis claude # abre sem Remote Control
```

O Remote Control exige login com uma conta claude.ai; ele não funciona com API key. Se não conseguir ligar, o Claude Code mostra o aviso e a sessão local continua funcionando.

### Atualizando os agentes

Sempre que você abre o Claude Code ou o Codex, o `jarvis` consulta a última versão publicada no npm. Se houver uma mais nova, ele pergunta antes de atualizar:

```console
$ jarvis claude
Nova versao do Claude Code: 2.1.285 -> 2.1.296. Atualizar agora? [s/N]
```

Ao aceitar, a imagem é reconstruída só com a nova versão desse agente; o outro continua como está. A consulta leva no máximo 3 segundos e é ignorada se você estiver offline. Para desativá-la, use `LLM_AGENT_NO_UPDATE_CHECK=1`.

Também dá para escolher as versões manualmente:

```sh
CLAUDE_CODE_VERSION=2.1.296 CODEX_VERSION=0.162.1 jarvis --build
```

Sem essas variáveis, o `jarvis --build` mantém as versões já instaladas na imagem. O atualizador interno do Claude Code fica desativado no container, porque as versões são gerenciadas pela imagem.

## Interface

```sh
jarvis ui          # sobe a interface e imprime a URL
jarvis ui --stop   # encerra a interface e as sessões abertas nela
```

Abra a URL impressa no navegador. No WSL2, ela funciona direto no navegador do Windows. Na primeira execução, o comando instala as dependências e constrói a interface (precisa de Node.js 22.18 ou mais novo no host).

A interface mostra:

- **Você:** o `CLAUDE.md` e o `AGENTS.md` globais e as memórias que o Claude Code e o Codex guardaram sobre você.
- **Skills:** as skills do Claude Code, dos plugins e do Codex.
- **Projetos:** todos os projetos em que você já usou o Claude Code ou o Codex, com conversas, memória, instruções e branch do git. Os repositórios git da pasta de projetos também aparecem, mesmo sem conversas, inclusive os que estão um nível abaixo (como `trabalho/api`). A pasta de projetos é a de `LLM_AGENT_PROJECTS_DIR` ou, sem ela, a pasta-mãe mais comum entre os projetos com conversas.

Em cada projeto, os botões **+ Claude**, **+ Codex** e **+ Shell** abrem uma sessão nova, e **Retomar** reabre uma conversa. As sessões rodam no `jarvis` de sempre, dentro do container, em abas na parte de baixo da tela. Elas continuam rodando se você fechar a página; ao reabrir, as abas voltam com o conteúdo. As abas se ajustam à barra, sem barra de rolagem: quanto mais abas, mais estreitas, até cerca de oito caracteres do nome. O nome que não couber termina em reticências e aparece inteiro ao passar o mouse, e só a aba ativa mostra a bolinha ao lado do nome. Se abrir mais abas do que cabem nessa largura, as que sobrarem ficam fora da vista, mas continuam acessíveis pelos atalhos.

No modo 3D, o centro é um globo holográfico: ele é a voz do Jarvis. Em volta do núcleo, milhares de fragmentos (traços, arcos e pequenos painéis) giram em faixas inclinadas, cada uma no seu sentido. Parado, o globo só deriva; ouvindo, ele pulsa; pensando, gira mais rápido; falando, acompanha o volume da voz: as camadas se expandem, os fragmentos crescem, tremem e brilham mais a cada sílaba (ligue **Demonstração de voz** para ver sem microfone). Em **Estilo do Jarvis**, nas configurações, o globo troca de desenho na hora: **Holográfico** (o padrão, descrito aqui), **Partículas** (uma nuvem de pontos em duas cascas) ou **Órbitas** (arcos e contas girando em planos diferentes, em volta de um núcleo maior); todos reagem à voz do mesmo jeito. Em **Cor do Jarvis** (dourado, ciano, branco, vermelho, verde ou roxo), a escolha vale na hora para o globo e para tudo o que é dourado na interface, inclusive a janela flutuante: trilha, ícones do topo, bordas, legendas e destaques. Os textos em cinza, os avisos e o terminal não mudam. Clicar no globo abre **Você**. À direita, de cima para baixo, ficam os cartões da área em que você está: Você, Projetos, Skills e Sessões abertas no início; dentro de um projeto, Sobre o projeto, Conversas, Memória, Instruções, git e os botões de nova sessão. Clicar num cartão abre os detalhes ou entra no nível seguinte; a trilha no topo mostra onde você está, e `Esc` volta.

Os botões **+ Sobre mim**, **+ Nova skill** e **+ Novo projeto** abrem uma sessão do Claude já instruída para a tarefa: registrar uma informação sobre você, criar uma skill ou preparar um projeto novo. As duas primeiras rodam numa pasta de trabalho própria (`~/.local/share/llm-agent/workspace`); o projeto novo é criado ao lado dos seus outros projetos (ou em `LLM_AGENT_PROJECTS_DIR`).

O espaço ocupa a tela toda. No canto superior direito ficam, nesta ordem, o campo de filtro (nos níveis que têm o que filtrar), o botão de notícias (ícone de jornal) e o de configurações (⚙). O botão de notícias abre o painel do dia (hora, data, clima e notícias) num modal centralizado na tela; `Esc`, o × ou um clique fora do modal fecham. O clima vem do [Open-Meteo](https://open-meteo.com/) (sem cadastro), usando a localização do navegador; para usar uma cidade fixa, defina `LLM_AGENT_UI_CITY` (por exemplo, `LLM_AGENT_UI_CITY="São Paulo" jarvis ui`). As notícias vêm do RSS do Google Notícias; `LLM_AGENT_UI_NEWS_RSS` troca a fonte. As coordenadas são enviadas ao Open-Meteo para buscar a previsão.

O botão ⚙ abre as configurações, no mesmo tipo de modal e agrupadas por assunto. Os blocos de cada grupo começam recolhidos sempre que o modal abre; clicar no título de um bloco o expande ou recolhe. Em **Voz**: **Como falar** (escuta ativa, **Falar com Ctrl+Espaço**, cujo nome acompanha o atalho escolhido, e **Atalho para falar**), **Sua voz**, **Transcrição da fala** e **Pausas da fala**. Em **Aparência e som**, no bloco **Visual e sons**: **Modo 3D** (troca para a interface em lista), **Estilo do Jarvis**, **Atalho para trocar o estilo**, **Cor do Jarvis**, **Reduzir movimento**, **Demonstração de voz** e **Sons de clique**. Em **Sistema**, no app desktop, **Iniciar com o sistema**. No navegador, **Sistema** traz **Abrir janela flutuante**: uma janelinha do Jarvis por cima das outras abas e programas (o navegador só a abre com um clique). Em GPUs mais fracas, a cena reduz a qualidade sozinha.

Enquanto algum agente trabalha em um terminal, uma frase no canto inferior direito, acima do terminal aberto, mostra quantos estão rodando (`2 tarefas rodando em background...`), com uma onda na cor do Jarvis passando pelas letras; sem nada rodando, ela não aparece. Shells não entram na conta, porque não há como saber se estão ocupados.

Com muitos terminais abertos, as abas encolhem até uma largura mínima e, dali em diante, a barra rola pelas setas ou pela roda do mouse; o botão com o número de terminais lista todos, com busca. A aba mostra um nome curto (`Shell 2`, o título da conversa, e o projeto quando há mais de um aberto), e o nome completo aparece ao passar o mouse. Abas de sessões encerradas ficam em itálico. A página não rola: só as áreas internas, como o histórico do terminal.

Atalhos: `Ctrl+1`…`Ctrl+9` vão para uma aba, `Ctrl+Tab` e `Ctrl+Shift+Tab` alternam (no navegador, esses dois são do próprio navegador), `Ctrl+Shift+W` fecha a aba e `Ctrl+K`, fora do terminal, abre a busca. Se ligado nas configurações, segurar `Ctrl+Espaço` (ou o atalho gravado em ⚙ → Voz, que pode incluir o botão do meio do mouse) fala com o Jarvis. No modo 3D, `Ctrl` mais o clique do scroll (ou o atalho gravado em ⚙ → Aparência e som) passa o globo para o próximo estilo.

O servidor escuta só em `127.0.0.1` (porta 7777, ou `LLM_AGENT_UI_PORT`) e exige o token que vai na URL, salvo em `~/.config/llm-agent/ui/token`. Quem tem a URL pode abrir agentes autônomos nos seus projetos, então não a compartilhe.

### Voz ("Hey Jarvis")

A escuta já vem ligada sempre que você abre o app (permita o microfone na primeira vez); para desligar até a próxima abertura, use **Escuta ativa** nas configurações (⚙). Chame "Jarvis" (ou "Hey Jarvis", "Ei, Jarvis"), ou já peça direto: "Jarvis, abre o projeto meu-app". O globo pulsa e o Jarvis passa a ouvir. Ele considera que você terminou de falar depois de 1 segundo de silêncio; se a frase parecer incompleta (termina em "e", "que", "pra", "de", "o meu"…), ele espera mais um pouco pela continuação, até 3 segundos no total, e então responde. Esses tempos e a lista de palavras podem ser ajustados em ⚙ → Voz → **Pausas da fala** (silêncio de 0,3 a 5 s, espera total até 15 s, palavras separadas por vírgula, com botão para restaurar as padrão; lista vazia faz ele responder logo depois do silêncio); só valem depois de clicar em **Salvar**, a partir da próxima fala, e o que não for salvo é descartado ao fechar as configurações. Se você continuar falando antes de ele responder, ele junta as duas partes e responde à fala completa (e, se a parte nova corrigir a anterior, como "não, na verdade abre o outro", vale só a nova). O que ele entendeu aparece na legenda. Ele responde em voz e volta a ouvir sozinho, sem precisar repetir "Hey Jarvis"; se você ficar em silêncio, ele espera. Para encerrar, despeça-se do seu jeito ("tchau", "obrigado, até amanhã", "por hoje é só"): ele se despede e volta a esperar ser chamado. Para interromper, diga "Jarvis", "para" ou "espera", ou simplesmente fale outra coisa por cima (ou aperte `Esc`): ele pausa na hora (cerca de 0,3 s) e decide pelo que você disse. "Para", "espera aí" ou "chega" encerram a resposta; uma pergunta, um comando ou uma correção ("e amanhã?", "abre o meu-app", "não, o outro") viram o próximo pedido; ruído, palavras soltas ou uma conversa com outra pessoa são ignorados, e ele retoma do começo da frase em que parou. Quando não é claro, um segundo Claude rápido decide (cerca de 1 s; desligue com `LLM_AGENT_VOICE_JUDGE=0` para que qualquer fala troque a resposta). O que ele estava fazendo antes continua em background. Para não se interromper com o eco da própria voz, o app compara o volume do microfone com o que o Jarvis está tocando naquele instante: ele aprende quanto da voz dele volta pelo microfone e só para quando há uma voz bem acima desse eco, ao mesmo tempo em que o detector de fala percebe alguém falando. Se o volume não deixar claro (caixas de som altas, sem cancelamento de eco), ele abaixa a voz e decide pelas palavras: um pedido de parada ou palavras que ele não disse interrompem; o eco das palavras dele é ignorado. Fones de ouvido deixam a interrupção perfeita.

O Jarvis responde também sobre o dia: clima de agora, notícias, data e hora (pelos mesmos dados do painel do dia). Ele também **pesquisa na web** sem abrir sessão: "pesquisa o que é computação quântica", "procura na internet quem ganhou o jogo ontem". A busca usa o DuckDuckGo e a Wikipedia em português (sem cadastro nem chave, cerca de 1 segundo), e o Jarvis responde em poucas frases com os pontos principais, dizendo de qual site veio cada informação. Quando o DuckDuckGo bloqueia a busca automática, a busca de reserva é a do próprio Claude (ferramenta WebSearch, no login do seu plano), mais lenta (15 a 20 segundos) porém confiável; `LLM_AGENT_VOICE_WEB_FALLBACK=0` a desliga. O assunto pesquisado é enviado a esses serviços. O Jarvis fala como um assistente pessoal, de forma natural, e conhece você pelas memórias que os agentes já guardaram (seção "Você"). Ele controla o app por voz: abre projetos e áreas, conta o estado de um projeto (git, commits, conversas recentes), abre sessões do Claude Code, do Codex ou do shell em background com uma tarefa, acompanha essas sessões e cria skills, projetos e anotações sobre você. Com a escuta ligada, o Jarvis também fala sozinho quando você não está conversando com ele: dá boas-vindas ao abrir o app (com o clima, se a localização estiver liberada), avisa quando o dia muda de período ("Já está à tarde, senhor", "Já está ficando a noite, senhor") e, a cada 90 minutos, entre 8h e 22h, conta as notícias novas do dia em uma frase. O botão **Desativar automáticas**, no bloco de notícias do painel do dia, para essas rodadas e as atualizações da lista de manchetes (o mesmo botão religa, e a escolha fica salva em `~/.config/llm-agent/ui/jarvis-news-auto.json`); o bloco continua na tela e as notícias continuam disponíveis quando você pede por voz. O Jarvis guarda as manchetes que já apresentou por voz (pedidas ou anunciadas por ele) por 2 dias e não as repete, nem em outra conversa: a cada pedido de notícias ele traz só as que ainda não contou e, se não houver novidade, avisa (o painel do dia continua mostrando todas). O histórico fica em `~/.config/llm-agent/ui/jarvis-news.json`. Ele nunca interrompe uma conversa: se estiver ocupado, deixa para depois. Você também pode falar com as sessões dos seus agentes: "manda pro Claude do meu-app: roda os testes" envia o recado na sessão; "quero falar direto com o Claude do meu-app" liga o **ditado**: o que você fala é digitado no terminal da sessão, sem enviar, e aparece numa barra na tela. Diga "envia" (ou clique em **▶ Enviar**) para enviar, "apaga" para desfazer o último trecho, "limpa" para apagar tudo, e "Jarvis, volta" (ou **Sair**) para voltar a falar com o Jarvis. "Fecha o terminal do meu-app" encerra a sessão. Quando o Jarvis abre uma sessão do Claude ou do Codex **com uma tarefa** ("abre um Claude no meu-app para corrigir os testes"), ele passa a **acompanhá-la sozinho**: observa o terminal em segundo plano e, quando a tarefa termina (o agente deixa de mostrar que está trabalhando e a tela fica uns 3 segundos parada, ou uns 30 segundos se ele nunca chegou a mostrar), avisa na hora que a sessão terminou e, em seguida, conta o resultado por voz em poucas frases e pergunta se você quer saber mais; se a sessão der erro, ele avisa o erro em resumo. Se o agente voltar a trabalhar até 1 minuto depois do aviso, o Jarvis continua acompanhando e avisa de novo no fim. Esse aviso sai mesmo no meio de uma conversa com ele, assim que houver uns 10 segundos de silêncio (ele não corta você nem a própria resposta); o "conta mais" logo depois é entendido como sendo sobre esse aviso. Um recado novo para essa sessão ("manda pro Claude do meu-app: agora roda os testes") continua sendo acompanhado do mesmo jeito. **Decisões pendentes:** quando qualquer sessão do Claude ou do Codex parar no terminal pedindo uma resposta sua (confiar na pasta, permitir um comando ou uma edição, escolher uma opção de uma pergunta), o Jarvis avisa por voz em cerca de 2 a 3 segundos, sem você perguntar, mesmo em sessões que não estão sendo acompanhadas. Ele avisa uma vez por pergunta e deixa de avisar se você responder antes; uma sessão acompanhada parada numa pergunta não é dada como terminada. Como os outros avisos, no meio de uma conversa ele espera o silêncio para falar. Sessões abertas sem tarefa não são acompanhadas, nem as abertas pelos botões da tela; para essas, peça: "me avisa quando a sessão dois terminar". "Não precisa mais avisar da sessão dois" para de acompanhar, inclusive nos próximos recados. Ele também conhece o app: perguntas como "como eu crio um projeto novo?" são respondidas a partir deste README. O cartão **Comandos de voz** (no início) lista o que dá para pedir, com exemplos; pergunte também "o que você sabe fazer?". Por segurança, ele só age por essas ferramentas: não tem shell nem escrita livre no seu computador, e o trabalho nos projetos vai para as sessões isoladas no container.

**Funcionalidades novas para o próprio Jarvis:** diga "Jarvis, quero criar uma funcionalidade nova para você" (ou "quero que você aprenda a…"). Ele conduz uma definição curta, uma pergunta por vez: o que dispara, o que ele faz ou diz, se aparece na tela, os casos especiais. Quando você disser que está tudo certo, ele lê o resumo do que vai desenvolver e pergunta se pode começar; só depois do seu segundo "pode começar" o desenvolvimento começa. Ele roda **em background**: uma sessão do Claude Code trabalha numa cópia separada do repositório (sempre em `~/.local/share/llm-agent/jarvis-dev/atual`, então você só confirma que confia nessa pasta uma vez), seguindo o `CLAUDE.md` do projeto, sem mexer no Jarvis que está rodando, e você continua conversando sobre qualquer coisa. Pergunte "como está a funcionalidade nova?" quando quiser. Quando terminar, ele avisa e pergunta se pode aplicar. Com o seu "sim", ele roda todos os testes, junta o código no repositório, recompila a interface e reinicia (se houver sessões abertas, ele avisa antes que elas serão fechadas). Ao voltar, o servidor confere os projetos, as ferramentas, a interface, a voz e o cérebro, e o Jarvis diz que a atualização foi aplicada e que está tudo funcionando; se algo essencial falhar, ele volta sozinho para a versão anterior e conta o que falhou. "Descarta a funcionalidade nova" apaga a proposta ou a cópia. Mudanças no app desktop só valem com um instalador novo.

**Memória:** o Jarvis guarda o que aprende nas conversas (seu nome, preferências, pessoas, metas e decisões dos projetos) e um resumo de cada conversa, e usa isso nas próximas, mesmo depois de reiniciar. Diga "lembra que…" para guardar algo na hora, "o que você lembra sobre mim?" para ouvir, e "esquece que…" para apagar. Na seção **Você**, "O Jarvis lembra" mostra tudo, com um botão para apagar cada item. Fica só no seu PC, em `~/.config/llm-agent/ui/jarvis-memory.json` (permissão 600). O conteúdo vai para o Claude junto com as instruções do Jarvis, como as memórias dos agentes.

**Issues:** diga "Jarvis, cria uma issue para ter mais cores no globo" e ele grava o pedido no `ISSUES.md` da pasta deste repositório, na seção **Pendentes**, com o próximo número, título e descrição. Esse arquivo é local: fica fora do Git, sem commit, e a primeira issue o cria se ele não existir. Ele só confirma, dizendo o número, depois de gravar; se não conseguir, avisa. Issue só registra o pedido: nada é implementado. Issues de outros projetos não entram nesse arquivo.

Tudo é gratuito: a palavra de ativação ([openWakeWord](https://github.com/dscripka/openWakeWord)) e a transcrição ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)) rodam na sua máquina, e a voz usa o [edge-tts](https://github.com/rany2/edge-tts) (vozes neurais da Microsoft, sem cadastro; precisa de internet). As respostas vêm do Claude (Haiku, pela velocidade; troque com `LLM_AGENT_VOICE_MODEL`) pelo Agent SDK, com o seu login: com o plano Pro/Max, isso consome os limites normais da assinatura. Nesta versão o Jarvis só conversa; abrir projetos e executar tarefas por voz vem depois.

**Falar com Ctrl+Espaço (opcional):** em ⚙ → Voz, ligue **Falar com Ctrl+Espaço** (vem desligado; a opção fica guardada neste navegador ou app). Com ela ligada, o atalho é o modo de falar com o Jarvis e a escuta contínua fica desligada: ele não espera mais ser chamado por "Jarvis". Segure `Ctrl+Espaço` e fale; ao soltar, ele considera a fala terminada e responde na hora, sem esperar silêncio nem frase incompleta. Enquanto você segura, uma onda sonora que acompanha o volume da sua voz aparece no topo da página, centralizada, logo abaixo da trilha de navegação (no modo lista, no topo do conteúdo), e some ao soltar. Apertar enquanto ele responde cala a resposta; apertar de novo antes de ele responder junta as duas falas. O atalho, de teclado ou mouse, funciona com o app em foco, inclusive com o cursor num terminal, e não fora dele. O microfone fica aberto para o atalho responder na hora, mas o áudio só sai da tela enquanto você segura (mais os 240 ms anteriores ao aperto, para não cortar o começo da fala). A voz cadastrada não é conferida nesse modo, porque quem aperta a tecla já está no computador. Avisos falados, como as boas-vindas e as notícias, continuam. Desligando a opção, tudo volta a ser por voz, como antes.

**Trocar o atalho de falar:** o padrão `Ctrl+Espaço` conflita com a busca de alguns navegadores, como o Opera. Em ⚙ → Voz, **Atalho para falar** mostra o atalho atual: clique em **Gravar**, segure o que quiser usar e solte; ele fica gravado ao soltar a primeira tecla. Vale uma tecla só, como `F9`, ou uma combinação de até três teclas, contando Ctrl, Shift, Alt e Win, como `Ctrl+Shift+J`, `Ctrl+Alt` ou `A+S`. O atalho também pode incluir o **botão do meio do mouse** (o clique do scroll), sozinho ou com teclas, como `Ctrl+Botão do meio`; os outros botões do mouse não entram. Segurar o atalho abre a captura de voz e soltar envia, seja qual for a escolha. Numa combinação de teclas comuns, como `A+S`, a primeira tecla ainda escreve até a última chegar, e uma tecla comum sozinha deixa de escrever no app; para digitar sem interferência, prefira `F9` ou uma combinação com Ctrl. O app não avisa nem bloqueia se o navegador ou o sistema já usarem o atalho: nesse caso, eles podem ficar com ele antes de chegar ao app. O clique do meio é o que mais costuma conflitar (rolagem automática, colar no Linux, abrir link em nova aba): dentro do app, o atalho impede essas funções, mas o sistema ou um programa do mouse ainda podem tomar o botão; se atrapalhar, grave outro atalho. Se o aparelho não tiver mouse, o botão do meio fica indisponível e, se estava no atalho, vale `Ctrl+Espaço`, com a escolha guardada para quando o mouse voltar. O navegador não informa quantos botões o mouse tem: um mouse sem o botão do meio apenas nunca o registra na gravação. A gravação recusa, com um aviso, a combinação exata que outro atalho da ferramenta já usa (o de trocar o estilo do globo, os das abas, `Ctrl+K` e `Ctrl+Alt+J`) e mantém o atalho anterior; parte de uma combinação não conta, então `Ctrl+Alt` continua valendo. Um atalho de falar gravado antes dessa regra continua funcionando e tem prioridade, com um aviso nas configurações. `Esc` cancela a gravação e **Voltar ao padrão** retorna a `Ctrl+Espaço`. A escolha fica guardada neste navegador ou app e continua valendo depois de reiniciar.

**Trocar o estilo do globo por atalho:** no modo 3D, `Ctrl` mais o clique do scroll passa o globo para o próximo estilo, na ordem Holográfico, Partículas, Órbitas, e volta ao começo. A troca é imediata e fica gravada como a escolha de **Estilo do Jarvis**. Para mudar o atalho, em ⚙ → Aparência e som → **Visual e sons**, **Atalho para trocar o estilo** grava do mesmo jeito que o atalho de falar, com as mesmas regras e a mesma recusa de combinações já usadas pela ferramenta; **Voltar ao padrão** retorna a `Ctrl+Botão do meio`. No modo lista, sem o globo na tela, o atalho não faz nada. Sem mouse no aparelho, grave um atalho de teclado para usar esse recurso.

**Só a sua voz (opcional):** em ⚙ → Voz → **Sua voz**, clique em **Cadastrar voz**, grave as 4 frases mostradas, num lugar silencioso, e depois chame o Jarvis 3 vezes ("Jarvis", "Hey Jarvis", "Ei, Jarvis"), do jeito e do lugar de onde você costuma chamar (cada chamada grava 2,5 s e para sozinha; enquanto o cadastro grava, o Jarvis não ouve o microfone). Na ativação, o chamado é comparado com as chamadas e com as frases, e vale a mais parecida: comparar uma palavra curta só com frases longas deixa a sua voz perto do limite e causa recusas. Cadastros antigos, sem as chamadas, continuam valendo só pelas frases; a área avisa para refazer a voz. Na primeira vez você define uma senha de no mínimo 8 caracteres (e, se quiser, um e-mail para recuperá-la); para refazer a voz depois, a senha é pedida. A partir daí, quando você chama o Jarvis (pela palavra de ativação ou por "Jarvis, ..."), ele compara a voz de quem chamou com a cadastrada: se bater, a conversa segue normalmente; se não, ele responde "acesso negado" e não executa nada, mesmo em repouso; a legenda mostra a fala ignorada (marcada como "ignorada"), e outros chamados recusados nos 30 segundos seguintes aparecem só na legenda, sem repetir o aviso em voz. Conversa de fundo que não chama o Jarvis é ignorada, sem resposta. A verificação acontece só no momento da ativação, não a cada fala da conversa: antes de comparar, o silêncio e o ruído em volta do chamado são cortados pelo detector de fala, e o cálculo da voz roda junto da transcrição (o modelo já é carregado quando o worker sobe), então quase não soma tempo. Esperando ser chamado, ele considera o chamado terminado depois de 0,6 s de silêncio (ou menos, se as pausas configuradas forem menores); se você chamar "Jarvis", fizer uma pausa e só então disser o pedido, ele junta as duas partes: não cumprimenta por cima de você e responde ao pedido (isso vale para a fala que começar até 10 s depois do chamado). Ele também entende o nome mesmo quando o whisper escreve errado ("Charvis", "Jervis", "Jar vis"). Cada verificação fica no log do servidor (`~/.config/llm-agent/ui/server.log`) com a semelhança, como `[voz] voz (ativação (40 ms)): semelhança 0.82 (chamadas 0.82, frases 0.58), mínimo 0.50 → aceita`: se a sua voz for recusada com frequência, veja os valores das suas chamadas e ajuste `LLM_AGENT_VOICE_SPEAKER_THRESHOLD`. A área mostra se há voz cadastrada e quando. Esqueceu a senha? Em **Esqueci a senha**, grave uma frase com a sua voz ou peça um código por e-mail (vale 15 minutos; o envio precisa de `LLM_AGENT_SMTP_URL`) e defina a senha nova. Cinco tentativas erradas bloqueiam por 5 minutos. O reconhecimento usa o modelo [WeSpeaker](https://github.com/wenet-e2e/wespeaker) (ONNX, ~26 MB, baixado na primeira vez) e roda no seu PC; o perfil (só um vetor numérico, sem o áudio) e a senha (com hash) ficam em `~/.config/llm-agent/ui/voice-profile.json` (permissão 600).

**Transcrição no Groq (opcional):** em ⚙ → Voz → **Transcrição da fala**, escolha **Groq (nuvem)**, cole a chave de API (crie em [console.groq.com/keys](https://console.groq.com/keys)) e salve. O app confere a chave com o Groq antes de salvar; ela fica só no seu PC, em `~/.config/llm-agent/ui/voice.json` (permissão 600), e a tela mostra apenas o começo e o fim. A transcrição fica bem mais rápida (cerca de 0,3 a 0,5 s, contra ~1,2 s do whisper local na CPU) e mais precisa. Vai para o Groq só o áudio do que você fala depois de chamar o Jarvis; a espera pelo nome continua local. Custa US$ 0,04 por hora de áudio no Whisper Large v3 Turbo (cada fala conta como no mínimo 10 s: umas 100 falas por dia dão cerca de US$ 0,35 por mês), e o plano gratuito do Groq costuma bastar para uso pessoal. Se o Groq falhar (sem internet, limite atingido), o Jarvis avisa e usa o whisper local.

Na primeira vez, o servidor cria um ambiente Python em `app/voice/.venv` e baixa os modelos (algumas centenas de MB); isso exige Python 3.10 ou mais novo com `venv` (no Ubuntu/Debian: `sudo apt install python3-venv`). Se o `python3` do sistema for antigo, o app usa sozinho uma versão mais nova instalada ao lado dele, como `python3.12` (nesse caso, o pacote é `python3.12-venv`). Se a versão do Python mudar, como numa atualização do Ubuntu, o app recria esse ambiente sozinho na próxima vez que a escuta for ligada. Configurações:

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `LLM_AGENT_PYTHON` | detectado | Python usado para criar o ambiente da voz (caminho ou comando); definido, é usado sem procurar outro |
| `LLM_AGENT_VOICE_MODEL` | `haiku` | modelo do Claude que responde |
| `LLM_AGENT_VOICE` | `pt-BR-AntonioNeural` | voz do edge-tts (`pt-BR-FranciscaNeural`, `pt-BR-ThalitaMultilingualNeural`…) |
| `LLM_AGENT_VOICE_STT_MODEL` | `auto` | modelo do whisper: `auto` usa o `small` na GPU NVIDIA e o `base` na CPU (mais rápido); `small` ou `medium` transcrevem melhor e demoram mais na CPU |
| `LLM_AGENT_VOICE_WAKE_THRESHOLD` | `0.5` | sensibilidade do "Hey Jarvis" (maior = menos ativações falsas) |
| `LLM_AGENT_VOICE_END_MS` | `1000` | silêncio (ms) que marca o fim da sua fala até o servidor mandar o valor de ⚙ → Voz → **Pausas da fala**, que é quem vale |
| `LLM_AGENT_VOICE_STT_THREADS` | `4` | threads do whisper na CPU (mais threads costumam piorar) |
| `LLM_AGENT_VOICE_WINDOW_S` | `30` | janela do whisper em segundos |
| `LLM_AGENT_VOICE_RATE` | `+15%` | velocidade da voz (`+0%` é o ritmo padrão do edge-tts; `+25%` fala ainda mais rápido) |
| `LLM_AGENT_VOICE_BARGE_IN` | `1` | `0` desliga a interrupção falando por cima |
| `LLM_AGENT_VOICE_GREETINGS` | 7 frases ("Estou à disposição, senhor."…) | saudações ditas quando você chama sem pedir nada, separadas por `|`; vazio desliga |
| `LLM_AGENT_VOICE_JUDGE` | `1` | `0` desliga o juiz das interrupções: qualquer fala por cima troca a resposta |
| `LLM_AGENT_VOICE_WEB_FALLBACK` | `1` | `0` desliga a busca de reserva do Claude quando o DuckDuckGo bloqueia (fica só a Wikipedia) |
| `LLM_AGENT_VOICE_ANNOUNCE` | `1` | `0` desliga as falas espontâneas (boas-vindas, período do dia, notícias) |
| `LLM_AGENT_VOICE_NEWS_EVERY_MIN` | `90` | minutos entre as rodadas de notícias (mínimo 15) |
| `LLM_AGENT_VOICE_NAME_WAKE` | `1` | `0` desliga o chamado só pelo nome (esperando, o whisper transcreve falas curtas para achar "Jarvis"; isso usa CPU) |
| `LLM_AGENT_VOICE_SPEAKER_THRESHOLD` | `0.5` | semelhança mínima (0 a 1) com a voz cadastrada para aceitar quem chamou (maior = mais rigoroso) |
| `LLM_AGENT_SMTP_URL` | (vazio) | servidor de e-mail para o código de recuperação da senha da voz, como `smtps://voce%40gmail.com:senha-de-app@smtp.gmail.com:465`; vazio: recuperação só pela voz |
| `LLM_AGENT_SMTP_FROM` | o usuário do SMTP | remetente desse e-mail |

Com GPU NVIDIA (no WSL, com o driver do Windows), a preparação da voz instala as bibliotecas CUDA e a transcrição roda na GPU, bem mais rápida. O painel do dia mostra os tempos da última resposta (transcrição, primeira palavra e voz), e o log do servidor (`~/.config/llm-agent/ui/server.log`) mostra o tempo de cada etapa de uma resposta (`[voz] latência: transcrição … · 1º token … · 1º áudio …`), útil para ajustar o modelo do whisper.

## App desktop (Windows e Ubuntu)

O **Jarvis** é a mesma interface numa janela própria (Tauri). Ao abrir, ele executa `llm-agent ui` (no Windows, dentro do WSL; no Ubuntu, direto) e carrega a interface; se algo falhar, mostra o erro e um botão para tentar de novo. O `llm-agent` precisa estar instalado (`./install.sh`; no Windows, dentro do WSL).

- **Instaladores:** baixe do último [release](https://github.com/FelipePy/llm-agents-docker/releases/latest), só o arquivo do seu sistema: `Jarvis_<versão>_x64-setup.exe` (Windows, recomendado), `Jarvis_<versão>_x64_en-US.msi` (Windows, instalação gerenciada), `Jarvis_<versão>_amd64.deb` (Ubuntu/Debian) ou `Jarvis_<versão>_amd64.AppImage` (outras distribuições). O release e os instaladores só saem quando pedidos: rode o workflow **desktop** na aba Actions ou com `gh workflow run desktop --ref main`. Na `main`, ele publica um release novo do projeto (a versão parte do arquivo `VERSION` e o patch sobe sozinho: 1.3.0, 1.3.1…; edite o `VERSION` para um salto maior); em outras branches, os instaladores ficam nos artefatos da execução, um por tipo. Antes de construir, ele roda todas as verificações, que também rodam sozinhas a cada push.
- **Atualizar:** rode o instalador novo com o Jarvis aberto mesmo: ele encerra o Jarvis (que normalmente só se esconde na bandeja) e instala por cima. Antivírus que mantêm o executável aberto (como o McAfee) também não travam mais a instalação nem a desinstalação: o executável antigo é renomeado e apagado. Se o seu Jarvis é anterior à 1.3.7 e o instalador acusar "Jarvis is running", escolha **Do not uninstall** na tela "Already Installed" (ou renomeie `%LOCALAPPDATA%\Jarvis\jarvis-desktop.exe` antes).
  - Windows: execute o `.msi` (ou o `.exe`) e abra **Jarvis** pelo menu Iniciar.
  - Ubuntu: `sudo apt install ./Jarvis_*.deb` e abra **Jarvis** pelo menu de aplicativos; ou `chmod +x Jarvis_*.AppImage && ./Jarvis_*.AppImage`.
- **Bolinha flutuante:** ao sair do app (outro programa em foco, janela minimizada ou fechada), uma bolinha do Jarvis fica na lateral da tela, por cima de tudo; ela brilha conforme ele ouve, pensa e fala, e mostra a última frase dele ao passar o mouse. Clique para voltar ao app; arraste para mudar de lugar. O Jarvis continua ouvindo.
- **Bandeja:** fechar a janela só a esconde. Pelo ícone na bandeja: mostrar, iniciar com o sistema, reiniciar o servidor ou sair.
- **Iniciar com o sistema:** nas configurações (⚙) ou na bandeja. O Jarvis abre minimizado, só com a bolinha, já ouvindo.
- **Atalho global:** `Ctrl+Alt+J` mostra ou esconde a janela de qualquer lugar.
- **Voz:** no app, o áudio toca sem precisar clicar antes e o microfone é liberado direto.
- **Erros ao abrir:** o que falhar sem impedir o app de abrir (a bolinha, o atalho) fica em `%LOCALAPPDATA%\dev.llmagent.jarvis\logs\jarvis.log` (no Ubuntu, `~/.local/share/dev.llmagent.jarvis/logs`).
- **Outra distribuição do WSL (Windows):** defina a variável de ambiente `JARVIS_WSL_DISTRO` (por exemplo, `Ubuntu-24.04`).

Para compilar à mão (Rust e Node instalados; no Ubuntu, também `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`; no Windows, as Build Tools do Visual Studio com C++):

```sh
cd app/desktop && npm ci && npm run icons
npx tauri dev     # abre o app em modo de desenvolvimento
npm run build     # instaladores em src-tauri/target/release/bundle/
```

## O que o container enxerga

| Caminho no host | No container | Acesso | Quando |
| --- | --- | --- | --- |
| projeto atual | mesmo caminho | leitura e escrita | sempre |
| `~/.claude`, `~/.claude.json` | `/home/agent/...` | leitura e escrita | sempre (criados se faltarem) |
| `~/.codex` | `/home/agent/.codex` | leitura e escrita | sempre (criado se faltar) |
| `$SSH_AUTH_SOCK` | `/ssh-agent` | uso do agente SSH | se houver SSH agent rodando |
| `~/.ssh`, `~/.config/gh`, `~/.gitconfig` | `/home/agent/...` | somente leitura | se existirem |
| `~/.zshrc`, `~/.oh-my-zsh`, `~/.nvm`, `~/.pyenv`, `~/.local/bin` | `/home/agent/...` | somente leitura | se existirem |
| `~/.agents`, `~/.bun` | `/home/agent/...` | leitura e escrita | se existirem |

Os mounts obrigatórios estão em [`docker-compose.yml`](docker-compose.yml); os opcionais são adicionados pelo script [`jarvis`](jarvis). Para remover algum (por exemplo, não expor `~/.ssh`), apague a linha `add_mount` correspondente no script.

## Segurança: o que o container **não** protege

O isolamento é de sistema de arquivos, não um sandbox completo. Saiba que:

- **O agente tem acesso à rede**, como qualquer container padrão.
- **Credenciais montadas são legíveis pelo agente**: tokens do Claude/Codex, token do `gh` e, se existir, sua pasta `~/.ssh` (somente leitura, mas as chaves privadas podem ser lidas). Remova os mounts que não quiser expor.
- Com o SSH agent repassado, o agente pode usar suas chaves (por exemplo, para `git push`) enquanto o container estiver rodando.
- O projeto montado pode ser alterado ou apagado — use git e faça commits com frequência.
- `sudo` não funciona dentro do container, por causa do `no-new-privileges`.

## Solução de problemas

**O Claude pede tema/login toda vez (dentro ou fora do container).**
Verifique se `~/.claude.json` é um arquivo e não um diretório. Versões antigas deste projeto (ou um `docker run` manual) podiam fazer o Docker criar um diretório vazio de root nesse caminho:

```sh
ls -ld ~/.claude.json
# se for um diretório vazio:
rmdir ~/.claude.json && echo '{}' > ~/.claude.json && chmod 600 ~/.claude.json
```

**Arquivos criados pelo agente pertencem a outro usuário.**
A imagem foi construída com outro UID/GID. Rode `jarvis --build` com o seu usuário.

**`permission denied` ao ler o `docker-compose.yml` ou o `Dockerfile` (com `--docker "sudo -u ..."`).**
O usuário do Docker não consegue ler a pasta do repositório. Mova o clone para um lugar acessível (por exemplo, `/opt/llm-agents-docker`) e rode o `./install.sh` de novo a partir de lá.

**`the input device is not a TTY`.**
O `jarvis` precisa de um terminal interativo; não o chame a partir de pipes ou scripts sem TTY.

## Desenvolvimento

Os testes do launcher usam um Docker falso e não precisam de Docker:

```sh
tests/remote-control.test.sh
tests/container-name.test.sh
tests/ui.test.sh                          # requer: npm --prefix app/server ci
npm --prefix app/server test              # servidor da interface
npm --prefix app/web test                 # lógica da interface
python3 -m unittest discover -s app/voice/tests -t app/voice   # worker de voz
```

Para mexer na interface com recarga automática:

```sh
LLM_AGENT_UI_ORIGINS=http://localhost:5173 jarvis ui   # copie o token da URL
npm --prefix app/web run dev                              # abra http://localhost:5173/#token=<token>
```

## Licença

[MIT](LICENSE)
