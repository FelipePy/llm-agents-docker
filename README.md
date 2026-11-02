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

Atalhos: `Ctrl+1`…`Ctrl+9` vão para uma aba, `Ctrl+Tab` e `Ctrl+Shift+Tab` alternam (no navegador, esses dois são do próprio navegador), `Ctrl+Shift+W` fecha a aba e `Ctrl+K`, fora do terminal, abre a busca.

O servidor escuta só em `127.0.0.1` (porta 7777, ou `LLM_AGENT_UI_PORT`) e exige o token que vai na URL, salvo em `~/.config/llm-agent/ui/token`. Quem tem a URL pode abrir agentes autônomos nos seus projetos, então não a compartilhe.

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
```

Para mexer na interface com recarga automática:

```sh
LLM_AGENT_UI_ORIGINS=http://localhost:5173 llm-agent ui   # copie o token da URL
npm --prefix app/web run dev                              # abra http://localhost:5173/#token=<token>
```

## Licença

[MIT](LICENSE)
