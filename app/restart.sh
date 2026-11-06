#!/usr/bin/env bash
# Reinicio verificado depois de o Jarvis aplicar uma funcionalidade nova nele
# mesmo (ferramenta aplicar_evolucao). Chamado pelo proprio servidor, num
# processo separado (o servidor morre no meio):
#
#   app/restart.sh <commit-anterior>
#
# 1. Para o servidor e sobe o novo (llm-agent ui).
# 2. Chama /api/self-check?record=1: o servidor novo confere projetos,
#    ferramentas, interface, voz e cerebro, e grava o resultado no update.json.
# 3. Se ele nao subir ou uma verificacao essencial falhar: marca o update.json
#    como revertido, volta o repositorio para <commit-anterior> e sobe a versao
#    anterior. O servidor que subir anuncia o resultado por voz.
#
# Variaveis (testes): LLM_AGENT_RESTART_UI (script de subir/parar, padrao
# app/ui.sh), LLM_AGENT_RESTART_REPO (repositorio, padrao a raiz deste).
set -uo pipefail

from="${1:?uso: restart.sh <commit-anterior>}"
app_dir="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
ui="${LLM_AGENT_RESTART_UI:-$app_dir/ui.sh}"
repo="${LLM_AGENT_RESTART_REPO:-$(dirname "$app_dir")}"
state_dir="${LLM_AGENT_UI_STATE_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/llm-agent/ui}"
update="$state_dir/update.json"
log() { echo "[atualização] $(date '+%H:%M:%S') $*"; }

self_check() {
  local port token
  port="$(grep -o '"port":[0-9]*' "$state_dir/server.json" 2>/dev/null | cut -d: -f2)"
  token="$(cat "$state_dir/token" 2>/dev/null)"
  [ -n "$port" ] && [ -n "$token" ] || return 1
  # So o "ok" de fora conta: as verificacoes que passaram tambem trazem "ok":true.
  curl -fsS --max-time 400 -H "Authorization: Bearer $token" "http://127.0.0.1:$port/api/self-check?record=1" |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { try { process.exit(JSON.parse(s).ok === true ? 0 : 1); } catch { process.exit(1); } });'
}

# Marca o update como revertido antes de subir a versao anterior (ela le isso ao abrir).
mark_rolled_back() {
  node -e '
    const fs = require("fs");
    const [file, error] = process.argv.slice(1);
    let u = {};
    try { u = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    fs.writeFileSync(file, JSON.stringify({ ...u, rolledBack: true, error }, null, 2) + "\n", { mode: 0o600 });
  ' "$update" "$1"
}

sleep "${LLM_AGENT_RESTART_DELAY:-2}" # deixa a resposta do Jarvis ("comecei a aplicar") terminar de sair
log "reiniciando com o código novo"
"$ui" --stop >/dev/null
if "$ui" >/dev/null; then
  if self_check; then
    log "verificações ok"
    exit 0
  fi
  reason="uma verificação essencial falhou"
else
  reason="o servidor novo não subiu"
fi

log "$reason; voltando para $from"
mark_rolled_back "$reason"
"$ui" --stop >/dev/null
# --keep: volta os arquivos do merge, mas recusa (em vez de apagar) se houver
# alteracoes nao salvas neles.
if ! git -C "$repo" reset --quiet --keep "$from"; then
  log "não consegui voltar o repositório para $from (alterações locais?)"
  mark_rolled_back "$reason; e não consegui voltar o código automaticamente"
fi
if "$ui" >/dev/null; then
  log "versão anterior de volta"
else
  log "a versão anterior também não subiu; rode llm-agent ui para ver o erro"
  exit 1
fi
