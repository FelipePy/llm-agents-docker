#!/usr/bin/env bash
# Testa os argumentos que o jarvis passa ao container, usando um "docker"
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

# run [VAR=valor ...] [args do jarvis]
run() {
  local vars=()
  while [ $# -gt 0 ] && [[ "$1" == *=* ]]; do vars+=("$1"); shift; done
  (cd "$proj" && env -u SSH_AUTH_SOCK -u LLM_AGENT_NO_REMOTE_CONTROL \
    HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" \
    LLM_AGENT_DOCKER="$fake" LLM_AGENT_NO_UPDATE_CHECK=1 \
    "${vars[@]}" "$repo/jarvis" "$@" </dev/null)
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
