#!/usr/bin/env bash
# Sobe (ou reaproveita) o servidor da interface e imprime a URL de acesso na
# ultima linha. Chamado por "jarvis ui".
#
# Uso:
#   jarvis ui          sobe ou reaproveita o servidor e imprime a URL
#   jarvis ui --stop   encerra o servidor e as sessoes abertas nele
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
# Campo numerico do /api/health de um servidor do jarvis ui na porta (vazio se nao for um).
health_field() {
  curl -fsS --max-time 2 "http://127.0.0.1:$1/api/health" 2>/dev/null | grep '"app":"llm-agent-ui"' | grep -o "\"$2\":[0-9]*" | cut -d: -f2
}
# Encerra um processo; se ele nao sair em 5 s (encerramento travado), forca.
stop_pid() {
  kill "$1" 2>/dev/null || return 0
  for _ in $(seq 1 50); do
    kill -0 "$1" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -9 "$1" 2>/dev/null
  for _ in $(seq 1 20); do
    kill -0 "$1" 2>/dev/null || return 0
    sleep 0.1
  done
}
# Avisa se o servidor em execucao e anterior ao codigo atual (ele nao se atualiza sozinho).
warn_outdated() {
  local started
  started="$(health_field "$1" startedAt)"
  [ -n "$started" ] || return 0
  if [ -n "$(find "$app_dir/server/src" -name '*.ts' -newermt "@$started" -print -quit 2>/dev/null)" ]; then
    echo "jarvis ui: o servidor em execução é de antes das últimas mudanças no código." >&2
    echo "Para atualizar: jarvis ui --stop && jarvis ui (fecha as sessões abertas)." >&2
  fi
}

if [ "${1:-}" = "--stop" ]; then
  # O do server.json e, se ele se perdeu, o que responde na porta (servidor orfao).
  # Porta sem resposta nao e erro: nao ha servidor, ou ele esta travado e sai pelo pid.
  pids="$(running_pid || true) $(health_field "$(json_field port || echo "$port")" pid || true) $(health_field "$port" pid || true)"
  stopped=""
  for pid in $(printf '%s\n' $pids | sort -u); do
    stop_pid "$pid"
    stopped=1
  done
  rm -f "$server_json"
  if [ -n "$stopped" ]; then echo "Servidor encerrado."; else echo "O servidor nao esta rodando."; fi
  exit 0
fi

for cmd in node curl; do
  command -v "$cmd" >/dev/null || { echo "jarvis ui: '$cmd' nao encontrado." >&2; exit 1; }
done

if running_pid >/dev/null && healthy "$(json_field port)"; then
  port="$(json_field port)"
  warn_outdated "$port"
elif orphan="$(health_field "$port" pid)" && [ -n "$orphan" ]; then
  # Servidor nosso na porta, mas sem server.json: volta a registra-lo (o --stop passa a ve-lo).
  echo "{\"pid\":$orphan,\"port\":$port}" >"$server_json"
  chmod 600 "$server_json"
  warn_outdated "$port"
else
  if [ -z "${LLM_AGENT_UI_NO_BUILD:-}" ]; then
    # Dependencias de um pacote (server ou web) faltando ou desatualizadas. O npm so grava o
    # node_modules/.package-lock.json no fim da instalacao: uma instalacao interrompida e refeita.
    deps_stale() {
      local marker="$app_dir/$1/node_modules/.package-lock.json"
      [ ! -f "$marker" ] || [ "$app_dir/$1/package-lock.json" -nt "$marker" ]
    }
    install_deps() {
      echo "$2" >&2
      npm --prefix "$app_dir/$1" ci --silent >&2 && return 0
      echo "Nao consegui instalar as dependencias ($1). Rode: npm --prefix $app_dir/$1 ci" >&2
      exit 1
    }
    deps_stale server && install_deps server "Instalando as dependencias do servidor..."
    dist="$app_dir/web/dist/index.html"
    if [ ! -f "$dist" ] || [ -n "$(find "$app_dir/web/src" "$app_dir/web/index.html" "$app_dir/web/public" "$app_dir/web/package.json" -newer "$dist" -print -quit 2>/dev/null)" ]; then
      # Primeira vez, ou o codigo da interface mudou (git pull, branch nova): reconstroi antes de subir.
      deps_stale web && install_deps web "Instalando as dependencias da interface..."
      echo "Construindo a interface..." >&2
      npm --prefix "$app_dir/web" run build --silent >&2 || { echo "A interface nao compilou. Rode: npm --prefix $app_dir/web run build" >&2; exit 1; }
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
    echo "jarvis ui: o servidor nao subiu. Ultimas linhas de $log:" >&2
    tail -n 20 "$log" >&2
    echo "Se a porta $port estiver ocupada, use LLM_AGENT_UI_PORT=<outra porta>." >&2
    exit 1
  fi
fi

echo "http://127.0.0.1:$port/#token=$(cat "$state_dir/token")"
