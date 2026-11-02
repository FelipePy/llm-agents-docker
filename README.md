# llm-agents-docker

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
- **Interface gráfica** (`llm-agent ui`): perfil, skills, projetos e conversas de todos os seus projetos, com terminais embutidos para abrir, retomar e alternar sessões do Claude Code, do Codex e do shell.

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
2. cria o comando `llm-agent` em `~/.local/bin` (um link para o script deste repositório; use `LLM_AGENT_BIN_DIR` para outro destino);
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

Entre na pasta do projeto e rode `llm-agent`. Um menu pergunta qual agente abrir:

```console
$ cd ~/projetos/meu-app
$ llm-agent
Qual agente abrir em /home/voce/projetos/meu-app?
  1) Claude Code
  2) Codex
  3) Shell (zsh)
Escolha [1-3]:
```

Pelo menu, os agentes abrem em **modo autônomo** (`claude --dangerously-skip-permissions` e `codex --dangerously-bypass-approvals-and-sandbox`), já que o container limita o que eles conseguem acessar.

Também dá para chamar o agente direto, com os argumentos que quiser:

```sh
llm-agent claude                                  # Claude Code pedindo permissões
llm-agent claude --dangerously-skip-permissions   # Claude Code autônomo
llm-agent codex                                   # Codex com aprovações normais
llm-agent claude --model opus                     # Claude Code com outro modelo
llm-agent zsh                                     # shell dentro do container
llm-agent --help                                  # ajuda
```

Tudo que vem depois de `llm-agent` é executado dentro do container, então os argumentos de cada CLI (como `--model`) funcionam normalmente. Para usar outro diretório sem entrar nele:

```sh
AGENT_WORKDIR=~/projetos/meu-app llm-agent claude
```

Por segurança, o script se recusa a rodar na sua home ou em `/`, pois isso exporia todos os seus arquivos ao agente.

Cada sessão roda em um container chamado `llm-agent-<comando>-<pasta>`, como `llm-agent-claude-meu-app`, o que facilita identificá-la em `docker ps`. Se você abrir o mesmo agente mais de uma vez no mesmo projeto, as sessões seguintes recebem `-2`, `-3` etc. O container é removido ao sair.

Se você ainda não fez login, faça uma vez (no host ou no container) — o login fica salvo no host e vale para os dois.

### Retomando conversas

O projeto é montado no **mesmo caminho absoluto** do host, então o Claude Code usa a mesma pasta de histórico (`~/.claude/projects/<caminho-do-projeto>`) dentro e fora do container:

```sh
llm-agent claude --continue   # retoma o último chat deste projeto
llm-agent claude --resume     # escolhe entre os chats deste projeto
```

Evite continuar o mesmo chat no host e no container ao mesmo tempo.

### Usando pelo celular (Remote Control)

Ao abrir o Claude Code, o `llm-agent` liga o Remote Control: a sessão aparece no app Claude do celular e em [claude.ai/code](https://claude.ai/code), e você pode continuar a conversa por lá enquanto o agente roda no seu computador.

A sessão recebe o nome do container sem o prefixo `llm-agent-`, como `claude-meu-app` (ou `claude-meu-app-2` numa segunda sessão no mesmo projeto).

```sh
llm-agent claude --remote-control outro-nome   # escolhe outro nome
LLM_AGENT_NO_REMOTE_CONTROL=1 llm-agent claude # abre sem Remote Control
```

O Remote Control exige login com uma conta claude.ai; ele não funciona com API key. Se não conseguir ligar, o Claude Code mostra o aviso e a sessão local continua funcionando.

### Atualizando os agentes

Sempre que você abre o Claude Code ou o Codex, o `llm-agent` consulta a última versão publicada no npm. Se houver uma mais nova, ele pergunta antes de atualizar:

```console
$ llm-agent claude
Nova versao do Claude Code: 2.1.285 -> 2.1.296. Atualizar agora? [s/N]
```

Ao aceitar, a imagem é reconstruída só com a nova versão desse agente; o outro continua como está. A consulta leva no máximo 3 segundos e é ignorada se você estiver offline. Para desativá-la, use `LLM_AGENT_NO_UPDATE_CHECK=1`.

Também dá para escolher as versões manualmente:

```sh
CLAUDE_CODE_VERSION=2.1.296 CODEX_VERSION=0.162.1 llm-agent --build
```

Sem essas variáveis, o `llm-agent --build` mantém as versões já instaladas na imagem. O atualizador interno do Claude Code fica desativado no container, porque as versões são gerenciadas pela imagem.

## Interface

```sh
llm-agent ui          # sobe a interface e imprime a URL
llm-agent ui --stop   # encerra a interface e as sessões abertas nela
```

Abra a URL impressa no navegador. No WSL2, ela funciona direto no navegador do Windows. Na primeira execução, o comando instala as dependências e constrói a interface (precisa de Node.js 22.18 ou mais novo no host).

A interface mostra:

- **Você:** o `CLAUDE.md` e o `AGENTS.md` globais e as memórias que o Claude Code e o Codex guardaram sobre você.
- **Skills:** as skills do Claude Code, dos plugins e do Codex.
- **Projetos:** todos os projetos em que você já usou o Claude Code ou o Codex, com conversas, memória, instruções e branch do git.

Em cada projeto, os botões **+ Claude**, **+ Codex** e **+ Shell** abrem uma sessão nova, e **Retomar** reabre uma conversa. As sessões rodam no `llm-agent` de sempre, dentro do container, em abas na parte de baixo da tela. Elas continuam rodando se você fechar a página; ao reabrir, as abas voltam com o conteúdo.

No modo 3D, o centro é um buraco negro: ele é a voz do Jarvis. Parado, o disco gira devagar; quando o Jarvis ouve, pensa e fala, o disco se agita, gira mais rápido e a fala se projeta nele em ondas que acompanham o volume (ligue **Demonstração de voz** para ver sem microfone). Os projetos orbitam como planetas (os mais recentes mais perto) e as skills formam o cinturão de estrelas; clicar num planeta abre o projeto e mostra as conversas como luas. À direita, de cima para baixo, ficam os cartões da área em que você está: Você, Projetos, Skills e Sessões abertas no início; dentro de um projeto, Sobre o projeto, Conversas, Memória, Instruções, git e os botões de nova sessão. Clicar num cartão abre os detalhes ou entra no nível seguinte; a trilha no topo mostra onde você está, e `Esc` volta. A opção **Planetas** esconde os planetas e as estrelas, deixando só o buraco negro e os cartões.

Os botões **+ Sobre mim**, **+ Nova skill** e **+ Novo projeto** abrem uma sessão do Claude já instruída para a tarefa: registrar uma informação sobre você, criar uma skill ou preparar um projeto novo. As duas primeiras rodam numa pasta de trabalho própria (`~/.local/share/llm-agent/workspace`); o projeto novo é criado ao lado dos seus outros projetos (ou em `LLM_AGENT_PROJECTS_DIR`).

O espaço ocupa a tela toda. O painel do dia (hora, data, clima, notícias e as opções) fica numa gaveta à esquerda, fechada ao abrir: clique na aba da borda esquerda para abrir. O clima vem do [Open-Meteo](https://open-meteo.com/) (sem cadastro), usando a localização do navegador; para usar uma cidade fixa, defina `LLM_AGENT_UI_CITY` (por exemplo, `LLM_AGENT_UI_CITY="São Paulo" llm-agent ui`). As notícias vêm do RSS do Google Notícias; `LLM_AGENT_UI_NEWS_RSS` troca a fonte. As coordenadas são enviadas ao Open-Meteo para buscar a previsão.

Na barra da esquerda, **Modo 3D** troca para a interface em lista, **Sons** liga os efeitos de clique e **Reduzir movimento** congela as animações. Em GPUs mais fracas, a cena reduz a qualidade sozinha.

Atalhos: `Ctrl+1`…`Ctrl+9` vão para uma aba, `Ctrl+Tab` e `Ctrl+Shift+Tab` alternam (no navegador, esses dois são do próprio navegador), `Ctrl+Shift+W` fecha a aba e `Ctrl+K`, fora do terminal, abre a busca.

O servidor escuta só em `127.0.0.1` (porta 7777, ou `LLM_AGENT_UI_PORT`) e exige o token que vai na URL, salvo em `~/.config/llm-agent/ui/token`. Quem tem a URL pode abrir agentes autônomos nos seus projetos, então não a compartilhe.

### Voz ("Hey Jarvis")

A escuta já vem ligada sempre que você abre o app (permita o microfone na primeira vez); para desligar até a próxima abertura, use **Escuta ativa** no painel do dia. Chame "Jarvis" (ou "Hey Jarvis", "Ei, Jarvis"), ou já peça direto: "Jarvis, abre o projeto meu-app". O buraco negro se agita e o Jarvis passa a ouvir (sua fala aparece na legenda enquanto você fala). Ele responde em voz e volta a ouvir sozinho, sem precisar repetir "Hey Jarvis"; se você ficar em silêncio, ele espera. Para encerrar, despeça-se ("tchau", "até mais"). Para interromper, é só começar a falar (ou dizer "Hey Jarvis", ou apertar `Esc`): ele para a frase e responde ao que você disse; o que ele estava fazendo antes continua em background.

O Jarvis responde também sobre o dia: clima de agora, notícias, data e hora (pelos mesmos dados do painel do dia). O Jarvis fala como um assistente pessoal, de forma natural, e conhece você pelas memórias que os agentes já guardaram (seção "Você"). Ele controla o app por voz: abre projetos e áreas, conta o estado de um projeto (git, commits, conversas recentes), abre sessões do Claude Code, do Codex ou do shell em background com uma tarefa, acompanha essas sessões e cria skills, projetos e anotações sobre você. Com a escuta ligada, o Jarvis também fala sozinho quando você não está conversando com ele: dá boas-vindas ao abrir o app (com o clima, se a localização estiver liberada), avisa quando o dia muda de período ("Já está à tarde, senhor", "Já está ficando a noite, senhor") e, a cada 90 minutos, entre 8h e 22h, conta as notícias novas do dia em uma frase. Ele nunca interrompe uma conversa: se estiver ocupado, deixa para depois. Você também pode falar com as sessões dos seus agentes: "manda pro Claude do meu-app: roda os testes" digita o recado na sessão; "quero falar direto com o Claude do meu-app" passa a enviar tudo o que você falar para lá, até você dizer "Jarvis, volta". Ele também conhece o app: perguntas como "como eu crio um projeto novo?" são respondidas a partir deste README. O cartão **Comandos de voz** (no início) lista o que dá para pedir, com exemplos; pergunte também "o que você sabe fazer?". Por segurança, ele só age por essas ferramentas: não tem shell nem escrita livre no seu computador, e o trabalho nos projetos vai para as sessões isoladas no container.

Tudo é gratuito: a palavra de ativação ([openWakeWord](https://github.com/dscripka/openWakeWord)) e a transcrição ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)) rodam na sua máquina, e a voz usa o [edge-tts](https://github.com/rany2/edge-tts) (vozes neurais da Microsoft, sem cadastro; precisa de internet). As respostas vêm do Claude (Haiku, pela velocidade; troque com `LLM_AGENT_VOICE_MODEL`) pelo Agent SDK, com o seu login: com o plano Pro/Max, isso consome os limites normais da assinatura. Nesta versão o Jarvis só conversa; abrir projetos e executar tarefas por voz vem depois.

Na primeira vez, o servidor cria um ambiente Python em `app/voice/.venv` e baixa os modelos (algumas centenas de MB); isso exige Python 3.10 ou mais novo com `venv` (no Ubuntu/Debian: `sudo apt install python3-venv`). Configurações:

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `LLM_AGENT_VOICE_MODEL` | `haiku` | modelo do Claude que responde |
| `LLM_AGENT_VOICE` | `pt-BR-AntonioNeural` | voz do edge-tts (`pt-BR-FranciscaNeural`, `pt-BR-ThalitaMultilingualNeural`…) |
| `LLM_AGENT_VOICE_STT_MODEL` | `small` | modelo do whisper (`base` é mais rápido; `medium` transcreve melhor) |
| `LLM_AGENT_VOICE_WAKE_THRESHOLD` | `0.5` | sensibilidade do "Hey Jarvis" (maior = menos ativações falsas) |
| `LLM_AGENT_VOICE_END_MS` | `500` | silêncio (ms) que marca o fim da sua fala |
| `LLM_AGENT_VOICE_RATE` | `+0%` | velocidade da voz (ex.: `+10%` fala um pouco mais rápido) |
| `LLM_AGENT_VOICE_BARGE_IN` | `1` | `0` desliga a interrupção falando por cima |
| `LLM_AGENT_VOICE_GREETINGS` | 7 frases ("Estou à disposição, senhor."…) | saudações ditas quando você chama sem pedir nada, separadas por `|`; vazio desliga |
| `LLM_AGENT_VOICE_ANNOUNCE` | `1` | `0` desliga as falas espontâneas (boas-vindas, período do dia, notícias) |
| `LLM_AGENT_VOICE_NEWS_EVERY_MIN` | `90` | minutos entre as rodadas de notícias (mínimo 15) |
| `LLM_AGENT_VOICE_NAME_WAKE` | `1` | `0` desliga o chamado só pelo nome (esperando, o whisper transcreve falas curtas para achar "Jarvis"; isso usa CPU) |

O log do servidor (`~/.config/llm-agent/ui/server.log`) mostra o tempo de cada etapa de uma resposta (`[voz] latência: transcrição … · 1º token … · 1º áudio …`), útil para ajustar o modelo do whisper.

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

Os mounts obrigatórios estão em [`docker-compose.yml`](docker-compose.yml); os opcionais são adicionados pelo script [`llm-agent`](llm-agent). Para remover algum (por exemplo, não expor `~/.ssh`), apague a linha `add_mount` correspondente no script.

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
A imagem foi construída com outro UID/GID. Rode `llm-agent --build` com o seu usuário.

**`permission denied` ao ler o `docker-compose.yml` ou o `Dockerfile` (com `--docker "sudo -u ..."`).**
O usuário do Docker não consegue ler a pasta do repositório. Mova o clone para um lugar acessível (por exemplo, `/opt/llm-agents-docker`) e rode o `./install.sh` de novo a partir de lá.

**`the input device is not a TTY`.**
O `llm-agent` precisa de um terminal interativo; não o chame a partir de pipes ou scripts sem TTY.

## Desenvolvimento

Os testes do launcher usam um Docker falso e não precisam de Docker:

```sh
tests/remote-control.test.sh
tests/ui.test.sh                          # requer: npm --prefix app/server ci
npm --prefix app/server test              # servidor da interface
npm --prefix app/web test                 # lógica da interface
python3 -m unittest discover -s app/voice/tests -t app/voice   # worker de voz
```

Para mexer na interface com recarga automática:

```sh
LLM_AGENT_UI_ORIGINS=http://localhost:5173 llm-agent ui   # copie o token da URL
npm --prefix app/web run dev                              # abra http://localhost:5173/#token=<token>
```

## Licença

[MIT](LICENSE)
