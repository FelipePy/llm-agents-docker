#!/usr/bin/env bash
# Testa o "llm-agent ui": sobe o servidor, reaproveita, protege a API e encerra.
# Requer Node >= 22.18 e "npm ci" ja executado em app/server.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [ ! -d "$repo/app/server/node_modules" ]; then
  echo "rode antes: npm --prefix app/server ci" >&2
  exit 1
fi

work="$(mktemp -d)"
export HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" LLM_AGENT_UI_NO_BUILD=1
LLM_AGENT_UI_PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
export LLM_AGENT_UI_PORT
mkdir -p "$HOME"
state="$XDG_CONFIG_HOME/llm-agent/ui"
base="http://127.0.0.1:$LLM_AGENT_UI_PORT"
cleanup() {
  "$repo/llm-agent" ui --stop >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

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
server_pid() { grep -o '"pid":[0-9]*' "$state/server.json" 2>/dev/null | cut -d: -f2; }

url="$("$repo/llm-agent" ui | tail -n 1)"
token="$(cat "$state/token" 2>/dev/null)"
check "imprime a URL com o token" "$base/#token=$token" "$url"
check "token tem permissao 600" "600" "$(stat -c %a "$state/token" 2>/dev/null)"
check "health responde" 'true' "$(curl -fsS "$base/api/health" | grep -o '"ok":true' | cut -d: -f2)"
check "API sem token: 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/overview")"
check "API com token: 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$base/api/overview")"

pid1="$(server_pid)"
"$repo/llm-agent" ui >/dev/null
check "reaproveita o servidor" "$pid1" "$(server_pid)"

"$repo/llm-agent" ui --stop >/dev/null
check "--stop encerra" "parado" "$(curl -fsS --max-time 1 "$base/api/health" >/dev/null 2>&1 && echo rodando || echo parado)"
check "--stop remove o server.json" "nao" "$([ -e "$state/server.json" ] && echo sim || echo nao)"

# Servidor orfao (server.json perdido): "ui" volta a registra-lo e "--stop" o encerra.
"$repo/llm-agent" ui >/dev/null
pid2="$(server_pid)"
rm -f "$state/server.json"
"$repo/llm-agent" ui >/dev/null 2>&1
check "reaproveita um servidor sem server.json" "$pid2" "$(server_pid)"
rm -f "$state/server.json"
"$repo/llm-agent" ui --stop >/dev/null
check "--stop encerra o servidor orfao" "parado" "$(curl -fsS --max-time 1 "$base/api/health" >/dev/null 2>&1 && echo rodando || echo parado)"

[ "$failures" -eq 0 ] && echo "todos os testes passaram" || { echo "$failures falha(s)"; exit 1; }
