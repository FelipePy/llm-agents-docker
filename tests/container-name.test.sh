#!/usr/bin/env bash
# Testa a escolha do nome do container com aberturas simultaneas, usando um
# "docker" falso (LLM_AGENT_DOCKER) que, como o de verdade, recusa um nome ja em
# uso: cada container e um diretorio criado com mkdir, que e atomico.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
trap 'chmod -R u+w "$work"; rm -rf "$work"' EXIT
proj="$work/meu-app"
state="$work/containers"
mkdir -p "$proj" "$work/home" "$state"
locks="$work/home/.config/llm-agent/locks"

fake="$work/docker"
cat > "$fake" <<'EOF'
#!/usr/bin/env bash
case "${1:-} ${2:-}" in
  # A demora deixa a corrida entre verificar e criar sempre visivel.
  "container inspect") sleep 0.1; [ -d "$FAKE_STATE/$3" ]; exit ;;
  "image inspect") exit 1 ;;
esac
while [ $# -gt 0 ] && [ "$1" != --name ]; do shift; done
name="$2"
shift 3 # --name <nome> agent
if ! mkdir "$FAKE_STATE/$name" 2>/dev/null; then
  echo "Error response from daemon: Conflict. The container name \"/$name\" is already in use" >&2
  exit 1
fi
printf '%s %s\n' "$name" "$*"
# Com FAKE_WAIT=N, a sessao so termina quando houver N containers abertos.
if [ -n "${FAKE_WAIT:-}" ]; then
  for _ in $(seq 100); do
    [ "$(ls "$FAKE_STATE" | wc -l)" -ge "$FAKE_WAIT" ] && break
    sleep 0.1
  done
  # Mantem o diretorio ate todas as sessoes verem o total.
  sleep 0.3
fi
rmdir "$FAKE_STATE/$name"
EOF
chmod +x "$fake"

run() {
  (cd "$proj" && env -u SSH_AUTH_SOCK -u LLM_AGENT_NO_REMOTE_CONTROL \
    HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" \
    LLM_AGENT_DOCKER="$fake" LLM_AGENT_NO_UPDATE_CHECK=1 FAKE_STATE="$state" \
    "$repo/jarvis" "$@" </dev/null)
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

# concurrent <n> <comando>: abre n sessoes ao mesmo tempo e grava as saidas em
# $work/out.* e os codigos de saida em $work/rc.*.
concurrent() {
  local n="$1" cmd="$2" i pids=()
  rm -f "$work"/out.* "$work"/rc.*
  export FAKE_WAIT="$n"
  for i in $(seq "$n"); do
    { run "$cmd" >"$work/out.$i" 2>&1; echo $? >"$work/rc.$i"; } &
    pids+=($!)
  done
  wait "${pids[@]}"
  unset FAKE_WAIT
}

# Os nomes base, base-2, ..., base-n, em ordem alfabetica.
expected_names() { # base n
  { echo "$1"; for i in $(seq 2 "$2"); do echo "$1-$i"; done; } | LC_ALL=C sort
}

n=8

concurrent "$n" zsh
check "todas as sessoes simultaneas abrem" \
  "$(printf '0\n%.0s' $(seq "$n"))" "$(cat "$work"/rc.* | tr -d ' ')"
check "nenhuma recebe conflito de nome" \
  "0" "$(cat "$work"/out.* | grep -c 'Conflict')"
check "cada sessao recebe um numero proprio, sem pular" \
  "$(expected_names llm-agent-zsh-meu-app "$n")" \
  "$(cat "$work"/out.* | cut -d' ' -f1 | LC_ALL=C sort)"

concurrent "$n" claude
check "o Remote Control usa o nome do proprio container" \
  "$(expected_names claude-meu-app "$n")" \
  "$(cat "$work"/out.* | sed -n 's/^llm-agent-\(.*\) claude --remote-control \1$/\1/p' | LC_ALL=C sort)"

check "o nome volta a ficar livre quando a sessao termina" \
  "llm-agent-zsh-meu-app zsh" "$(run zsh)"

mkdir "$state/llm-agent-zsh-meu-app"
check "pula o nome de um container existente sem lock" \
  "llm-agent-zsh-meu-app-2 zsh" "$(run zsh)"
rmdir "$state/llm-agent-zsh-meu-app"

flock -n "$locks/llm-agent-zsh-meu-app.lock" sleep 5 &
holder=$!
for _ in $(seq 50); do
  flock -n "$locks/llm-agent-zsh-meu-app.lock" true || break
  sleep 0.05
done
check "pula o nome reservado que ainda nao tem container" \
  "llm-agent-zsh-meu-app-2 zsh" "$(run zsh)"
kill "$holder" 2>/dev/null
wait "$holder" 2>/dev/null

# Sem poder gravar o lock, abre como antes em vez de impedir a sessao.
rm -rf "$locks"
chmod a-w "$work/home/.config/llm-agent"
check "sem pasta de locks a sessao abre mesmo assim" \
  "llm-agent-zsh-meu-app zsh" "$(run zsh 2>/dev/null)"
chmod u+w "$work/home/.config/llm-agent"

[ "$failures" -eq 0 ] && echo "todos os testes passaram" || { echo "$failures falha(s)"; exit 1; }
