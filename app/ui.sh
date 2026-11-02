#!/usr/bin/env bash
# Sobe (ou reaproveita) o servidor da interface e imprime a URL de acesso na
# ultima linha. Chamado por "llm-agent ui".
#
# Uso:
#   llm-agent ui          sobe ou reaproveita o servidor e imprime a URL
#   llm-agent ui --stop   encerra o servidor e as sessoes abertas nele
#
# Variaveis:
#   LLM_AGENT_UI_PORT      porta (padrao: 7777)
#   LLM_AGENT_UI_ORIGINS   origens extras aceitas, separadas por virgula
#                          (ex.: http://localhost:5173 para o "npm run dev")
#   LLM_AGENT_UI_NO_BUILD=1  nao instala dependencias nem constroi a UI
set -euo pipefail

app_dir="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
state_dir="${XDG_CONFIG_HOME:-$HOME/.config}/llm-agent/ui"
server_json="$state_dir/server.json"
log="$state_dir/server.log"
port="${LLM_AGENT_UI_PORT:-7777}"
mkdir -p "$state_dir"
chmod 700 "$state_dir"

json_field() { grep -o "\"$1\":[0-9]*" "$server_json" 2>/dev/null | cut -d: -f2; }
running_pid() {
  local pid
  pid="$(json_field pid)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
}
healthy() { curl -fsS --max-time 2 "http://127.0.0.1:$1/api/health" >/dev/null 2>&1; }

if [ "${1:-}" = "--stop" ]; then
  if pid="$(running_pid)"; then
    kill "$pid"
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    rm -f "$server_json"
    echo "Servidor encerrado."
  else
    rm -f "$server_json"
    echo "O servidor nao esta rodando."
  fi
  exit 0
fi

for cmd in node curl; do
  command -v "$cmd" >/dev/null || { echo "llm-agent ui: '$cmd' nao encontrado." >&2; exit 1; }
done

if running_pid >/dev/null && healthy "$(json_field port)"; then
  port="$(json_field port)"
else
  if [ -z "${LLM_AGENT_UI_NO_BUILD:-}" ]; then
    if [ ! -d "$app_dir/server/node_modules" ]; then
      echo "Instalando dependencias do servidor..." >&2
      npm --prefix "$app_dir/server" ci --silent >&2
    fi
    if [ ! -f "$app_dir/web/dist/index.html" ]; then
      echo "Construindo a interface (so na primeira vez)..." >&2
      npm --prefix "$app_dir/web" ci --silent >&2
      npm --prefix "$app_dir/web" run build --silent >&2
    fi
  fi
  LLM_AGENT_UI_PORT="$port" LLM_AGENT_UI_STATE_DIR="$state_dir" \
    setsid nohup node "$app_dir/server/src/main.ts" >>"$log" 2>&1 </dev/null &
  server=$!
  for _ in $(seq 1 50); do
    healthy "$port" && break
    kill -0 "$server" 2>/dev/null || break
    sleep 0.2
  done
  if ! healthy "$port"; then
    echo "llm-agent ui: o servidor nao subiu. Ultimas linhas de $log:" >&2
    tail -n 20 "$log" >&2
    echo "Se a porta $port estiver ocupada, use LLM_AGENT_UI_PORT=<outra porta>." >&2
    exit 1
  fi
fi

echo "http://127.0.0.1:$port/#token=$(cat "$state_dir/token")"
