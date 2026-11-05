#!/usr/bin/env bash
# Testa os links criados pelo install.sh, com um "docker" falso.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" LLM_AGENT_BIN_DIR="$work/bin"
mkdir -p "$HOME" "$work/fake" "$work/bin"
printf '#!/bin/sh\nexit 0\n' >"$work/fake/docker"
chmod +x "$work/fake/docker"
export PATH="$work/fake:$PATH"

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
install() { "$repo/install.sh" "$@" >/dev/null 2>&1; }

install
check "instala sem erro" "0" "$?"
check "cria o comando jarvis" "$repo/jarvis" "$(readlink -f "$work/bin/jarvis")"
check "mantem o nome antigo para o app desktop" "$repo/jarvis" "$(readlink -f "$work/bin/llm-agent")"

install
check "instalar de novo nao falha" "0" "$?"

# Pasta do repositorio renomeada: os links antigos ficam quebrados e sao refeitos.
ln -sfn "$work/pasta-antiga/jarvis" "$work/bin/jarvis"
ln -sfn "$work/pasta-antiga/llm-agent" "$work/bin/llm-agent"
install
check "refaz o link quebrado do jarvis" "$repo/jarvis" "$(readlink -f "$work/bin/jarvis")"
check "refaz o link quebrado do nome antigo" "$repo/jarvis" "$(readlink -f "$work/bin/llm-agent")"

# Arquivo que nao e deste repositorio: nao sobrescreve.
rm -f "$work/bin/jarvis"
echo outro >"$work/bin/jarvis"
install
check "recusa sobrescrever outro comando" "1" "$?"
check "preserva o outro comando" "outro" "$(cat "$work/bin/jarvis")"
rm -f "$work/bin/jarvis"
install

install --uninstall
check "--uninstall remove o jarvis" "nao" "$([ -e "$work/bin/jarvis" ] && echo sim || echo nao)"
check "--uninstall remove o nome antigo" "nao" "$([ -e "$work/bin/llm-agent" ] && echo sim || echo nao)"

[ "$failures" -eq 0 ] && echo "todos os testes passaram" || { echo "$failures falha(s)"; exit 1; }
