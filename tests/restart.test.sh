#!/usr/bin/env bash
# Testa o app/restart.sh com um "ui" falso: um servidor minimo em Node cujo
# /api/self-check responde ok ou falha conforme o commit do repositorio.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
trap 'kill $(cat "$work/pid" 2>/dev/null) 2>/dev/null; rm -rf "$work"' EXIT
export LLM_AGENT_UI_STATE_DIR="$work/state"
mkdir -p "$LLM_AGENT_UI_STATE_DIR"
echo tok >"$LLM_AGENT_UI_STATE_DIR/token"

# Repositorio com dois commits: "bom" e, depois dele, "ruim" (self-check falha).
repo="$work/repo"
git init -q -b main "$repo"
git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m bom
good="$(git -C "$repo" rev-parse HEAD)"
echo ruim >"$repo/versao"
git -C "$repo" add versao
git -C "$repo" -c user.name=t -c user.email=t@t commit -q -m ruim

cat >"$work/server.js" <<'EOF'
const http = require('http');
const fs = require('fs');
const ok = !fs.existsSync(process.argv[2] + '/versao');
const srv = http.createServer((req, res) => res.end(JSON.stringify({ ok, checks: [] })));
srv.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(process.argv[3] + '/server.json', JSON.stringify({ pid: process.pid, port: srv.address().port }));
});
EOF
cat >"$work/ui.sh" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "--stop" ]; then kill \$(cat "$work/pid" 2>/dev/null) 2>/dev/null; rm -f "$work/state/server.json"; sleep 0.2; exit 0; fi
node "$work/server.js" "$repo" "$work/state" & echo \$! >"$work/pid"
for _ in \$(seq 1 50); do [ -f "$work/state/server.json" ] && exit 0; sleep 0.1; done
exit 1
EOF
chmod +x "$work/ui.sh"
export LLM_AGENT_RESTART_UI="$work/ui.sh" LLM_AGENT_RESTART_REPO="$repo"

failures=0
check() {
  if [ "$3" = "$2" ]; then echo "ok - $1"; else echo "FAIL - $1 (esperado: $2, obtido: $3)"; failures=$((failures + 1)); fi
}

echo '{"title":"X","announced":false}' >"$work/state/update.json"
bash "$repo_root/app/restart.sh" "$good" >"$work/log" 2>&1
check "verificacao falhou: volta para o commit anterior" "$good" "$(git -C "$repo" rev-parse HEAD)"
check "marca o update como revertido" "true" "$(grep -o '"rolledBack": true' "$work/state/update.json" | cut -d' ' -f2)"
check "sobe a versao anterior" "ok" "$(curl -fsS "http://127.0.0.1:$(grep -o '"port":[0-9]*' "$work/state/server.json" | cut -d: -f2)/" | grep -q '"ok":true' && echo ok)"

echo '{"title":"Y","announced":false}' >"$work/state/update.json"
bash "$repo_root/app/restart.sh" "$good" >"$work/log" 2>&1
check "verificacao ok: mantem o codigo e nao marca revertido" "nao" "$(grep -q rolledBack "$work/state/update.json" && echo sim || echo nao)"

[ "$failures" -eq 0 ] && echo "todos os testes passaram" || { echo "$failures falha(s)"; cat "$work/log"; exit 1; }
