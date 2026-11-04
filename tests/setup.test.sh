#!/usr/bin/env bash
# Testa o app/setup.sh (instalacao do app desktop) com pacotes falsos: cada um
# traz um app/ui.sh minimo que sobe um servidor em Node; o /api/self-check dele
# falha se o pacote tiver o arquivo "ruim". O app/restart.sh e o de verdade.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
export HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" XDG_DATA_HOME="$work/home/.local/share"
state="$XDG_CONFIG_HOME/llm-agent/ui"
root="$XDG_DATA_HOME/llm-agent"
mkdir -p "$state" "$HOME/.local/bin"
echo tok >"$state/token"
stop_server() { kill "$(grep -o '"pid":[0-9]*' "$state/server.json" 2>/dev/null | cut -d: -f2)" 2>/dev/null; rm -f "$state/server.json"; }
trap 'stop_server; rm -rf "$work"' EXIT

failures=0
check() {
  if [ "$3" = "$2" ]; then echo "ok - $1"; else echo "FAIL - $1 (esperado: $2, obtido: $3)"; failures=$((failures + 1)); fi
}

# Pacote falso da versao $1 (com "ruim": o self-check falha).
payload() {
  local dir="$work/src-$1"
  mkdir -p "$dir/app/voice"
  echo "$1" >"$dir/VERSION"
  printf '#!/usr/bin/env bash\nexec "$(dirname "$(readlink -f "$0")")/app/ui.sh" "$@"\n' >"$dir/llm-agent"
  cp "$repo_root/app/restart.sh" "$dir/app/restart.sh"
  [ "${2:-}" = ruim ] && touch "$dir/ruim"
  cat >"$dir/app/server.js" <<'EOF'
const http = require('http');
const fs = require('fs');
const path = require('path');
const [dir, state] = process.argv.slice(2);
const ok = !fs.existsSync(path.join(dir, 'ruim'));
const version = fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim();
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/api/health')) return res.end(JSON.stringify({ ok: true, app: 'llm-agent-ui', pid: process.pid, version }));
  res.end(JSON.stringify({ ok, query: req.url, checks: [] }));
});
srv.listen(0, '127.0.0.1', () => fs.writeFileSync(path.join(state, 'server.json'), JSON.stringify({ pid: process.pid, port: srv.address().port })));
EOF
  cat >"$dir/app/ui.sh" <<'EOF'
#!/usr/bin/env bash
dir="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd -P)"
state="$XDG_CONFIG_HOME/llm-agent/ui"
pid="$(grep -o '"pid":[0-9]*' "$state/server.json" 2>/dev/null | cut -d: -f2)"
if [ "${1:-}" = "--stop" ]; then [ -n "$pid" ] && kill "$pid" 2>/dev/null; rm -f "$state/server.json"; sleep 0.2; exit 0; fi
if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$state/server.json"
  setsid node "$dir/app/server.js" "$dir" "$state" >/dev/null 2>&1 </dev/null &
  for _ in $(seq 1 50); do [ -f "$state/server.json" ] && break; sleep 0.1; done
fi
echo "http://127.0.0.1:$(grep -o '"port":[0-9]*' "$state/server.json" | cut -d: -f2)/#token=tok"
EOF
  chmod +x "$dir/llm-agent" "$dir/app/ui.sh"
  tar -C "$dir" -czf "$work/p-$1.tar.gz" .
  echo "$work/p-$1.tar.gz"
}
running_version() {
  curl -fsS "http://127.0.0.1:$(grep -o '"port":[0-9]*' "$state/server.json" | cut -d: -f2)/api/health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4
}
setup() { bash "$repo_root/app/setup.sh" "$@" 2>>"$work/err"; }

p1="$(payload 1.0.0)"
check "start nao instala do zero (precisa da aprovacao)" "1 nao" "$(setup start --payload "$p1" >/dev/null; echo $? $([ -e "$root/current" ] && echo sim || echo nao))"
setup install --payload "$p1" app >/dev/null
rm -rf "$root"
out="$(setup deploy "$p1"; setup start --payload "$p1")"
check "primeira abertura: imprime a URL na ultima linha" "http://127.0.0.1:" "$(echo "$out" | tail -1 | grep -o '^http://127.0.0.1:')"
check "mostra o progresso da instalacao" "@status Instalando o Jarvis 1.0.0…" "$(echo "$out" | head -1)"
check "current aponta para a versao" "$root/versions/1.0.0" "$(readlink -f "$root/current")"
check "cria o comando llm-agent" "$root/current/llm-agent" "$(readlink "$HOME/.local/bin/llm-agent")"
check "a versao instalada e um repositorio git (evolucao)" "Jarvis 1.0.0" "$(git -C "$root/current" log -1 --format=%s 2>/dev/null)"
check "o ambiente da voz fica fora da versao" "$root/voice-venv" "$(readlink "$root/current/app/voice/.venv")"
check "setup.sh version" "1.0.0" "$(setup version)"

marker="$(stat -c %Y "$root/current/.jarvis-complete")"
out="$(setup start --payload "$p1")"
check "mesma versao: nao reinstala" "$marker" "$(stat -c %Y "$root/current/.jarvis-complete")"
check "mesma versao: sem passo de instalacao" "" "$(echo "$out" | grep -c 'Instalando\|Atualizando' | grep -v '^0$')"

p2="$(payload 1.1.0)"
setup start --payload "$p2" >/dev/null
check "atualizacao com o servidor no ar: reinicia na versao nova" "1.1.0" "$(running_version)"
check "atualizacao: current na versao nova" "$root/versions/1.1.0" "$(readlink -f "$root/current")"
check "guarda a versao anterior para voltar" "sim" "$([ -d "$root/versions/1.0.0" ] && echo sim)"

p3="$(payload 1.2.0 ruim)"
out="$(setup start --payload "$p3")"
check "versao nova reprovada: volta para a anterior" "$root/versions/1.1.0" "$(readlink -f "$root/current")"
check "versao nova reprovada: servidor anterior no ar" "1.1.0" "$(running_version)"
check "versao nova reprovada: imprime a URL mesmo assim" "http://127.0.0.1:" "$(echo "$out" | tail -1 | grep -o '^http://127.0.0.1:')"
check "versao reprovada fica registrada" "1.2.0" "$(cat "$root/failed-version" 2>/dev/null)"
check "versao reprovada nao fica no disco; a mais antiga sai" "nao nao" "$([ -d "$root/versions/1.2.0" ] && echo sim || echo nao) $([ -d "$root/versions/1.0.0" ] && echo sim || echo nao)"
setup start --payload "$p3" >/dev/null
check "versao reprovada nao e tentada de novo a cada abertura" "1.1.0" "$(running_version)"

stop_server
p4="$(payload 1.3.0)"
setup start --payload "$p4" >/dev/null
check "atualizacao com o servidor parado: sobe a versao nova" "1.3.0" "$(running_version)"

ln -sfn /outro/clone/llm-agent "$HOME/.local/bin/llm-agent"
setup deploy "$(payload 1.4.0)" >/dev/null
check "llm-agent de um clone (install.sh) nao e trocado" "/outro/clone/llm-agent" "$(readlink "$HOME/.local/bin/llm-agent")"

dev="$work/src-dev"
payload 9.9.9 >/dev/null
mv "$work/src-9.9.9" "$dev"
setup start --repo "$dev" --restart >/dev/null
check "desenvolvimento (--repo): sobe o servidor do clone" "9.9.9" "$(running_version)"

check "comando desconhecido falha" "1" "$(setup nada >/dev/null 2>&1; echo $?)"

[ "$failures" -eq 0 ] && echo "todos os testes passaram" || { echo "$failures falha(s)"; cat "$work/err"; exit 1; }
