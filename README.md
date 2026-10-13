# llm-agents-docker

Rode agentes de código LLM — **Claude Code** e **Codex** — dentro de um container Docker que enxerga **apenas o projeto em que você está trabalhando**.

Agentes como esses costumam ser usados em modo autônomo (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`). Rodá-los no container limita o estrago possível: o agente pode editar o projeto montado, mas não o resto da sua home, outros projetos ou o sistema.

## Recursos

- Imagem única com Claude Code e Codex (versões fixadas e configuráveis).
- Usa o **mesmo login e configuração** dos CLIs no host (`~/.claude`, `~/.claude.json`, `~/.codex`) — nada de logar de novo.
- **Histórico de chats compartilhado** com o host: um chat iniciado fora do container pode ser retomado dentro dele (e vice-versa) com `claude --resume`.
- Usuário do container com o mesmo UID/GID do seu usuário, então os arquivos criados pertencem a você.
- Repassa, se existirem no host: SSH agent, `~/.ssh`, `gh`, `~/.gitconfig`, `~/.zshrc`/oh-my-zsh, nvm, pyenv, bun e `~/.local/bin`.
- Container sem capabilities (`cap_drop: ALL`) e com `no-new-privileges`.

## Requisitos

- Linux (ou WSL2) com Docker e o plugin `docker compose` v2.
- Uma conta do Claude e/ou da OpenAI para os respectivos CLIs.

## Instalação

```sh
git clone https://github.com/FelipePy/llm-agents-docker.git
cd llm-agents-docker

# Coloca o comando no PATH (opcional, mas recomendado)
mkdir -p ~/.local/bin
ln -s "$PWD/llm-agent" ~/.local/bin/llm-agent

# Constroi a imagem com o seu UID/GID
llm-agent --build
```

## Uso

Entre na pasta do projeto e chame o agente:

```sh
cd ~/projetos/meu-app

llm-agent claude                                  # Claude Code
llm-agent claude --dangerously-skip-permissions   # Claude Code sem pedir permissões
llm-agent                                         # Codex (comando padrão, já sem aprovações)
llm-agent codex                                   # Codex com aprovações normais
llm-agent zsh                                     # shell dentro do container
```

Tudo que vem depois de `llm-agent` é executado dentro do container. Para usar outro diretório sem entrar nele:

```sh
AGENT_WORKDIR=~/projetos/meu-app llm-agent claude
```

Por segurança, o script se recusa a rodar na sua home ou em `/`, pois isso exporia todos os seus arquivos ao agente.

Se você ainda não fez login, faça uma vez (no host ou no container) — o login fica salvo no host e vale para os dois.

### Retomando conversas

O projeto é montado no **mesmo caminho absoluto** do host, então o Claude Code usa a mesma pasta de histórico (`~/.claude/projects/<caminho-do-projeto>`) dentro e fora do container:

```sh
llm-agent claude --continue   # retoma o último chat deste projeto
llm-agent claude --resume     # escolhe entre os chats deste projeto
```

Evite continuar o mesmo chat no host e no container ao mesmo tempo.

### Atualizando os CLIs

As versões são fixadas na imagem. Para trocar:

```sh
CLAUDE_CODE_VERSION=2.1.285 CODEX_VERSION=0.149.0 llm-agent --build
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

**`the input device is not a TTY`.**
O `llm-agent` precisa de um terminal interativo; não o chame a partir de pipes ou scripts sem TTY.

## Licença

[MIT](LICENSE)
