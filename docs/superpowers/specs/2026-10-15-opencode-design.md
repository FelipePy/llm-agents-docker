# OpenCode no container

## Objetivo

Permitir rodar o [OpenCode](https://opencode.ai) no container do `llm-agent`, do mesmo jeito que o Claude Code e o Codex: mesma imagem, versão fixada, opção no menu, checagem de atualização e login/sessões compartilhados com o host.

## Decisões

- **Instalação:** pacote npm `opencode-ai`, no mesmo `npm install -g` dos outros CLIs. Versão padrão: `1.19.1`.
- **Estado:** compartilhado com o host (leitura e escrita), como `~/.claude` e `~/.codex`.
- **Modo autônomo:** o OpenCode não tem flag equivalente a `--dangerously-skip-permissions`. Pelo menu, ele roda com `OPENCODE_PERMISSION='{"*":"allow"}'`, só naquela execução. `llm-agent opencode [args]` chamado direto usa a configuração do usuário.

## Imagem

### `Dockerfile`

- `ARG OPENCODE_VERSION=1.19.1`.
- Adicionar `"opencode-ai@${OPENCODE_VERSION}"` ao `npm install -g`.
- Criar, com dono `agent`: `/home/agent/.config/opencode`, `/home/agent/.local/share/opencode`, `/home/agent/.local/state/opencode` e `/home/agent/.cache/opencode`. Sem isso, o Docker cria os diretórios pais (`~/.local`, `~/.cache`) como root ao montar, e o agente não conseguiria gravar neles.
- Label `llm-agent.opencode="${OPENCODE_VERSION}"`.

### `docker-compose.yml`

- Build arg `OPENCODE_VERSION: "${OPENCODE_VERSION:-1.19.1}"`.
- Variável `OPENCODE_DISABLE_AUTOUPDATE: "1"`, porque as versões são gerenciadas pela imagem.
- Mounts obrigatórios, todos de leitura e escrita e com `create_host_path: false`:

| Host | Container | Conteúdo |
| --- | --- | --- |
| `~/.config/opencode` | `/home/agent/.config/opencode` | config, agentes, comandos |
| `~/.local/share/opencode` | `/home/agent/.local/share/opencode` | `auth.json`, sessões |
| `~/.local/state/opencode` | `/home/agent/.local/state/opencode` | estado da TUI |
| `~/.cache/opencode` | `/home/agent/.cache/opencode` | pacotes de providers (evita baixar tudo a cada execução) |

## Script `llm-agent`

- Criar os 4 diretórios acima com `mkdir -p` antes de rodar o compose, como já é feito para `~/.codex`.
- Menu: `1) Claude Code`, `2) Codex`, `3) OpenCode`, `4) Shell (zsh)`.
- Novo array `run_args`, passado entre `run --rm` e `agent`. A opção 3 coloca nele `-e OPENCODE_PERMISSION={"*":"allow"}` (objeto JSON; a string `"allow"` é rejeitada pelo OpenCode).
- `check_update opencode opencode-ai OPENCODE_VERSION "OpenCode"` quando o primeiro argumento for `opencode`.
- `build_image` preserva `OPENCODE_VERSION` lido da imagem, como faz com as outras versões.
- `compose()` grava `OPENCODE_VERSION` no `env_file` quando definida e a inclui no `env -u`.
- Atualizar o texto de ajuda (uso e variáveis).

## README

- Título e recursos: incluir o OpenCode.
- Menu e exemplos de uso: incluir `llm-agent opencode` e explicar o modo autônomo via `OPENCODE_PERMISSION`.
- Atualizações: incluir `OPENCODE_VERSION` no exemplo de build manual.
- Tabela "O que o container enxerga": incluir os 4 caminhos do OpenCode.
- Segurança: citar `~/.local/share/opencode/auth.json` entre as credenciais legíveis pelo agente.

## Verificação

Não há testes automatizados no projeto. Validar com:

1. `bash -n llm-agent`.
2. `docker compose config` com as variáveis necessárias, para checar o YAML.
3. `llm-agent --build` e `llm-agent opencode --version` (deve imprimir `1.19.1`).
4. Confirmar no container que `OPENCODE_PERMISSION='{"*":"allow"}'` é aceito pela versão instalada. Se não for, ajustar o valor para o formato aceito antes de concluir.
