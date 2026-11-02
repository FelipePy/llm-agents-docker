# Remote Control automático: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao abrir o Claude Code, o `llm-agent` liga o Remote Control com o nome da sessão igual ao do container sem o prefixo `llm-agent-`.

**Architecture:** O launcher em bash calcula o nome do container antes do `compose run` e, se o comando for `claude`, insere `--remote-control <nome>` logo após `claude`. Os testes rodam o script real com um "docker" falso (via `LLM_AGENT_DOCKER`) que imprime os argumentos de `compose run`.

**Tech Stack:** bash, docker compose (só o falso, nos testes).

Spec: `docs/superpowers/specs/2026-11-02-remote-control-design.md`

## Global Constraints

- O nome da sessão é o nome do container sem o prefixo `llm-agent-` (ex.: `claude-meu-app`, `claude-meu-app-2`).
- Nada é acrescentado se algum argumento for `--remote-control` ou começar com `--remote-control=`.
- Nada é acrescentado com `LLM_AGENT_NO_REMOTE_CONTROL` não vazia.
- `codex`, `zsh`, `--build` e outros comandos não mudam.
- Textos do script e do README em português sem acentos no script (padrão atual dos comentários) e com acentos no README (padrão atual).

---

### Task 1: Injetar `--remote-control` no launcher

**Files:**
- Create: `tests/remote-control.test.sh`
- Modify: `llm-agent` (cabeçalho de uso, linhas 2-19; bloco final, linhas 238-243)

**Interfaces:**
- Consumes: `container_name` (já existe no `llm-agent`), `LLM_AGENT_DOCKER` (já existe).
- Produces: função bash `has_remote_control_arg "$@"` (retorna 0 se algum argumento for `--remote-control` ou `--remote-control=*`); variável de ambiente `LLM_AGENT_NO_REMOTE_CONTROL`; script de teste `tests/remote-control.test.sh` (sai com 0 se todos os casos passarem).

- [ ] **Step 1: Escrever o teste**

Criar `tests/remote-control.test.sh`:

```bash
#!/usr/bin/env bash
# Testa os argumentos que o llm-agent passa ao container, usando um "docker"
# falso (LLM_AGENT_DOCKER) que imprime o que viria depois de "compose ... run".
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
proj="$work/meu-app"
mkdir -p "$proj" "$work/home"

fake="$work/docker"
cat > "$fake" <<'EOF'
#!/usr/bin/env bash
case "${1:-} ${2:-}" in
  # Nomes listados em FAKE_TAKEN contam como containers ja existentes.
  "container inspect") [[ " ${FAKE_TAKEN:-} " == *" $3 "* ]]; exit ;;
  "image inspect") exit 1 ;;
esac
while [ $# -gt 0 ] && [ "$1" != run ]; do shift; done
shift
printf '%s\n' "$*"
EOF
chmod +x "$fake"

# run [VAR=valor ...] [args do llm-agent]
run() {
  local vars=()
  while [ $# -gt 0 ] && [[ "$1" == *=* ]]; do vars+=("$1"); shift; done
  (cd "$proj" && env -u SSH_AUTH_SOCK -u LLM_AGENT_NO_REMOTE_CONTROL \
    HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" \
    LLM_AGENT_DOCKER="$fake" LLM_AGENT_NO_UPDATE_CHECK=1 \
    "${vars[@]}" "$repo/llm-agent" "$@" </dev/null)
}

failures=0
check() { # descricao esperado obtido
  if [ "$3" = "$2" ]; then
    echo "ok - $1"
  else
    echo "FAIL - $1"
    echo "  esperado: $2"
    echo "  obtido:   $3"
    failures=$((failures + 1))
  fi
}

prefix="--rm --name llm-agent-claude-meu-app agent"

check "claude liga o Remote Control" \
  "$prefix claude --remote-control claude-meu-app" \
  "$(run claude)"
check "flags do usuario vem depois" \
  "$prefix claude --remote-control claude-meu-app --dangerously-skip-permissions" \
  "$(run claude --dangerously-skip-permissions)"
check "segunda sessao usa o sufixo -2" \
  "--rm --name llm-agent-claude-meu-app-2 agent claude --remote-control claude-meu-app-2" \
  "$(run FAKE_TAKEN=llm-agent-claude-meu-app claude)"
check "--remote-control do usuario nao duplica" \
  "$prefix claude --remote-control teste" \
  "$(run claude --remote-control teste)"
check "--remote-control=nome do usuario nao duplica" \
  "$prefix claude --remote-control=teste" \
  "$(run claude --remote-control=teste)"
check "LLM_AGENT_NO_REMOTE_CONTROL=1 desliga" \
  "$prefix claude" \
  "$(run LLM_AGENT_NO_REMOTE_CONTROL=1 claude)"
check "codex nao muda" \
  "--rm --name llm-agent-codex-meu-app agent codex" \
  "$(run codex)"
check "zsh nao muda" \
  "--rm --name llm-agent-zsh-meu-app agent zsh" \
  "$(run zsh)"

[ "$failures" -eq 0 ] && echo "todos os testes passaram" || { echo "$failures falha(s)"; exit 1; }
```

```bash
chmod +x tests/remote-control.test.sh
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `tests/remote-control.test.sh`
Expected: `FAIL` nos casos "claude liga o Remote Control", "flags do usuario vem depois" e "segunda sessao usa o sufixo -2"; `ok` nos outros cinco (que já valem hoje); termina com `3 falha(s)`.

Se casos que deveriam passar falharem, o problema é o harness (docker falso), não o launcher: corrigir o teste antes de seguir.

- [ ] **Step 3: Implementar**

Em `llm-agent`, substituir o bloco final:

```bash
if [ "${1:-}" = "--build" ]; then
  shift
  build_image "$@"
else
  compose "${override_args[@]}" run --rm --name "$(container_name "${1:-}")" agent "$@"
fi
```

por:

```bash
# Verdadeiro se o usuario ja passou --remote-control (com ou sem nome).
has_remote_control_arg() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --remote-control | --remote-control=*) return 0 ;;
    esac
  done
  return 1
}

if [ "${1:-}" = "--build" ]; then
  shift
  build_image "$@"
else
  name="$(container_name "${1:-}")"
  # O Claude Code abre com Remote Control (app Claude no celular e
  # claude.ai/code), nomeado como o container: claude-<pasta>[-N]. Sem nome,
  # ele usaria o hostname, que no container e um ID aleatorio.
  if [ "${1:-}" = claude ] && [ -z "${LLM_AGENT_NO_REMOTE_CONTROL:-}" ] \
    && ! has_remote_control_arg "$@"; then
    set -- claude --remote-control "${name#llm-agent-}" "${@:2}"
  fi
  compose "${override_args[@]}" run --rm --name "$name" agent "$@"
fi
```

No cabeçalho de uso (linhas 2-19), trocar a linha:

```bash
#   llm-agent claude [args]   abre o Claude Code
```

por:

```bash
#   llm-agent claude [args]   abre o Claude Code (com Remote Control)
```

e, logo depois da linha `#   LLM_AGENT_NO_UPDATE_CHECK=1          nao procura versoes novas ao abrir`, inserir:

```bash
#   LLM_AGENT_NO_REMOTE_CONTROL=1        abre o Claude Code sem Remote Control
```

- [ ] **Step 4: Rodar e ver passar**

Run: `tests/remote-control.test.sh && bash -n llm-agent && (command -v shellcheck >/dev/null && shellcheck llm-agent tests/remote-control.test.sh || echo "shellcheck ausente")`
Expected: oito linhas `ok - ...`, `todos os testes passaram`, e nenhum aviso do shellcheck (ou `shellcheck ausente`).

Run: `./llm-agent --help | grep -i remote`
Expected: as duas linhas novas do cabeçalho.

- [ ] **Step 5: Commit**

```bash
git add llm-agent tests/remote-control.test.sh
git commit -m "Start Claude Code with Remote Control named after the container"
```

---

### Task 2: Documentar no README

**Files:**
- Modify: `README.md` (lista "Recursos"; nova subseção após "### Retomando conversas")

**Interfaces:**
- Consumes: comportamento e `LLM_AGENT_NO_REMOTE_CONTROL` da Task 1; `tests/remote-control.test.sh`.
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Item na lista de recursos**

Em `## Recursos`, depois do item "**Histórico de chats compartilhado** ...", inserir:

```markdown
- **Remote Control ligado por padrão**: toda sessão do Claude Code aparece no app Claude do celular e em claude.ai/code.
```

- [ ] **Step 2: Nova subseção**

Logo antes de `### Atualizando os agentes`, inserir:

````markdown
### Usando pelo celular (Remote Control)

Ao abrir o Claude Code, o `llm-agent` liga o Remote Control: a sessão aparece no app Claude do celular e em [claude.ai/code](https://claude.ai/code), e você pode continuar a conversa por lá enquanto o agente roda no seu computador.

A sessão recebe o nome do container sem o prefixo `llm-agent-`, como `claude-meu-app` (ou `claude-meu-app-2` numa segunda sessão no mesmo projeto).

```sh
llm-agent claude --remote-control outro-nome   # escolhe outro nome
LLM_AGENT_NO_REMOTE_CONTROL=1 llm-agent claude # abre sem Remote Control
```

O Remote Control exige login com uma conta claude.ai; ele não funciona com API key. Se não conseguir ligar, o Claude Code mostra o aviso e a sessão local continua funcionando.
````

- [ ] **Step 3: Seção de testes**

No fim do README, antes da seção de licença se houver (senão no fim do arquivo), inserir:

````markdown
## Desenvolvimento

Os testes do launcher usam um Docker falso e não precisam de Docker:

```sh
tests/remote-control.test.sh
```
````

- [ ] **Step 4: Conferir**

Run: `grep -n -E "Remote Control|NO_REMOTE_CONTROL|Desenvolvimento" README.md`
Expected: o item da lista, o título da subseção, a linha com `LLM_AGENT_NO_REMOTE_CONTROL` e o título `## Desenvolvimento`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Document Remote Control in the README"
```

---

### Task 3: Verificação manual com o Claude Code real

**Files:** nenhum (só verificação; se algo falhar, voltar à Task 1).

- [ ] **Step 1:** Num projeto qualquer, `llm-agent`, opção 1. Expected: no app Claude do celular, a sessão `claude-<pasta>` aparece e responde.
- [ ] **Step 2:** Com a primeira aberta, outro terminal no mesmo projeto: `llm-agent claude`. Expected: sessão `claude-<pasta>-2`.
- [ ] **Step 3:** `LLM_AGENT_NO_REMOTE_CONTROL=1 llm-agent claude`. Expected: nenhuma sessão nova no celular.
- [ ] **Step 4:** `llm-agent codex`. Expected: abre como antes.
