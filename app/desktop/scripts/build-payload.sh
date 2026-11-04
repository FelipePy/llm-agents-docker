#!/usr/bin/env bash
# Monta o pacote do llm-agents-docker que vai dentro do instalador do Jarvis:
#   src-tauri/payload/llm-agents-docker.tar.gz   o repositorio (arquivos versionados,
#       com o que ainda nao foi commitado), a interface ja construida (app/web/dist)
#       e as dependencias de producao do servidor (app/server/node_modules, Linux x64)
#   src-tauri/payload/setup.sh                   o instalador (app/setup.sh)
# No Windows o pacote e copiado para dentro do WSL: monte-o sempre no Linux.
#
# Uso: scripts/build-payload.sh [versao]   (padrao: o arquivo VERSION da raiz)
set -euo pipefail

desktop="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
repo="$(cd "$desktop/../.." && pwd -P)"
out="$desktop/src-tauri/payload"
version="${1:-$(tr -d '[:space:]' <"$repo/VERSION")}"
version="${version#v}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tree="$work/tree"
mkdir -p "$tree"

# Arquivos versionados (e os novos ainda nao ignorados), sem os planos de desenvolvimento.
git -C "$repo" ls-files -z --cached --others --exclude-standard |
  grep -zv -e '^docs/' -e '^app/desktop/src-tauri/payload/' |
  while IFS= read -r -d '' f; do [ -e "$repo/$f" ] && printf '%s\0' "$f"; done |
  tar -C "$repo" --null -T - -cf - | tar -C "$tree" -xf -
echo "$version" >"$tree/VERSION"

echo "Dependências do servidor (produção)..."
npm --prefix "$tree/app/server" ci --omit=dev --silent --no-audit --no-fund
echo "Construindo a interface..."
npm --prefix "$tree/app/web" ci --silent --no-audit --no-fund
npm --prefix "$tree/app/web" run build --silent
rm -rf "$tree/app/web/node_modules"

mkdir -p "$out"
rm -f "$out/llm-agents-docker.tar.gz" "$out/setup.sh"
tar -C "$tree" --owner=0 --group=0 -czf "$out/llm-agents-docker.tar.gz" .
cp "$repo/app/setup.sh" "$out/setup.sh"
echo "Pacote $version: $(du -h "$out/llm-agents-docker.tar.gz" | cut -f1) ($out)"
