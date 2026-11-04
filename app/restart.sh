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
# Atualizacao do app desktop (app/setup.sh), com cada versao numa pasta:
#
#   app/restart.sh --switch <link> <pasta-anterior>
#
# Os mesmos passos, mas a volta aponta o <link> de novo para <pasta-anterior>
# (em vez do git reset) e o update.json da evolucao nao e tocado. A voz so e
# verificada se o ambiente dela ja estiver instalado.
#
# Variaveis (testes): LLM_AGENT_RESTART_UI (script de subir/parar, padrao
# app/ui.sh), LLM_AGENT_RESTART_REPO (repositorio, padrao a raiz deste).
set -uo pipefail

switch_link=""
if [ "${1:-}" = "--switch" ]; then
  switch_link="${2:?uso: restart.sh --switch <link> <pasta-anterior>}"
  from="${3:?uso: restart.sh --switch <link> <pasta-anterior>}"
else
  from="${1:?uso: restart.sh <commit-anterior>}"
fi
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
  local query="record=1"
  if [ -n "$switch_link" ]; then
    query="record=0"
    [ -f "$switch_link/app/voice/.venv/.installed" ] || query="$query&voice=0"
  fi
  # So o "ok" de fora conta: as verificacoes que passaram tambem trazem "ok":true.
  curl -fsS --max-time 400 -H "Authorization: Bearer $token" "http://127.0.0.1:$port/api/self-check?$query" |
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
"$ui" --stop >/dev/null
if [ -n "$switch_link" ]; then
  ln -sfn "$from" "$switch_link.new" && mv -T "$switch_link.new" "$switch_link"
  if "$ui" >/dev/null; then
    log "versão anterior de volta"
    exit 0
  fi
  log "a versão anterior também não subiu; rode llm-agent ui para ver o erro"
  exit 1
fi
mark_rolled_back "$reason"
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
