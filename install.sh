#!/usr/bin/env bash
# Instala o comando llm-agent e constroi a imagem com o seu UID/GID.
#
# Uso:
#   ./install.sh               instala em ~/.local/bin (ou $LLM_AGENT_BIN_DIR)
#   ./install.sh --uninstall   remove o comando
set -euo pipefail

repo_dir="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
bin_dir="${LLM_AGENT_BIN_DIR:-$HOME/.local/bin}"
target="$bin_dir/llm-agent"

if [ "${1:-}" = "--uninstall" ]; then
  if [ "$(readlink -f "$target" 2>/dev/null)" = "$repo_dir/llm-agent" ]; then
    rm -f "$target"
    echo "Removido: $target"
  else
    echo "Nada a remover: $target nao aponta para este repositorio."
  fi
  echo "A imagem local/llm-agent-safe continua no Docker; remova com:"
  echo "  docker rmi local/llm-agent-safe:latest"
  exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Erro: Docker com o plugin 'docker compose' v2 e necessario." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Erro: sem acesso ao Docker. Verifique se o daemon esta rodando e se" >&2
  echo "seu usuario esta no grupo 'docker' (sudo usermod -aG docker \$USER)." >&2
  exit 1
fi

mkdir -p "$bin_dir"
if [ -e "$target" ] || [ -L "$target" ]; then
  if [ "$(readlink -f "$target")" != "$repo_dir/llm-agent" ]; then
    echo "Erro: $target ja existe e nao e deste repositorio. Remova-o e rode de novo." >&2
    exit 1
  fi
else
  ln -s "$repo_dir/llm-agent" "$target"
fi
echo "Comando instalado: $target"

echo "Construindo a imagem (pode levar alguns minutos)..."
"$repo_dir/llm-agent" --build

echo
echo "Pronto! Entre em um projeto e rode: llm-agent"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    echo
    echo "Atencao: $bin_dir nao esta no seu PATH. Adicione ao ~/.bashrc ou ~/.zshrc:"
    echo "  export PATH=\"$bin_dir:\$PATH\""
    ;;
esac
