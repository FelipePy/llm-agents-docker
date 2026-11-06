#!/usr/bin/env bash
# Instala o comando llm-agent e constroi a imagem com o seu UID/GID.
#
# Uso:
#   ./install.sh                 instala em ~/.local/bin (ou $LLM_AGENT_BIN_DIR)
#   ./install.sh --docker "CMD"  usa CMD para chamar o Docker, por exemplo
#                                "sudo -u dockeruser docker" quando so outro
#                                usuario tem acesso ao Docker
#   ./install.sh --uninstall     remove o comando
#
# Rode sempre com o SEU usuario (o que vai usar os agentes), mesmo que o
# Docker so seja acessivel por outro.
set -euo pipefail

repo_dir="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
bin_dir="${LLM_AGENT_BIN_DIR:-$HOME/.local/bin}"
target="$bin_dir/llm-agent"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/llm-agent"
config_file="$config_dir/config"

usage() { sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "$0"; }

docker_value=""
uninstall=false
while [ $# -gt 0 ]; do
  case "$1" in
    --docker)
      [ $# -ge 2 ] || { echo "Erro: --docker precisa de um comando." >&2; exit 1; }
      docker_value="$2"
      shift 2
      ;;
    --uninstall) uninstall=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Erro: opcao desconhecida: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if $uninstall; then
  if [ "$(readlink -f "$target" 2>/dev/null)" = "$repo_dir/llm-agent" ]; then
    rm -f "$target"
    echo "Removido: $target"
  else
    echo "Nada a remover: $target nao aponta para este repositorio."
  fi
  if [ -f "$config_file" ]; then
    rm -f "$config_file"
    rmdir "$config_dir" 2>/dev/null || true
    echo "Removido: $config_file"
  fi
  echo "A imagem local/llm-agent-safe continua no Docker; remova com:"
  echo "  docker rmi local/llm-agent-safe:latest"
  exit 0
fi

if [ -n "$docker_value" ]; then
  mkdir -p "$config_dir"
  printf 'LLM_AGENT_DOCKER=%q\n' "$docker_value" > "$config_file"
  LLM_AGENT_DOCKER="$docker_value"
  echo "Comando do Docker salvo em $config_file: $docker_value"
elif [ -f "$config_file" ]; then
  # shellcheck source=/dev/null
  . "$config_file"
fi
read -ra docker_cmd <<< "${LLM_AGENT_DOCKER:-docker}"

if ! "${docker_cmd[@]}" compose version >/dev/null 2>&1; then
  echo "Erro: nao foi possivel rodar '${docker_cmd[*]} compose'." >&2
  echo "E necessario o Docker com o plugin 'docker compose' v2." >&2
  exit 1
fi
if ! "${docker_cmd[@]}" info >/dev/null 2>&1; then
  echo "Erro: sem acesso ao Docker com '${docker_cmd[*]}'." >&2
  echo "Verifique se o daemon esta rodando e se seu usuario pode usa-lo" >&2
  echo "(grupo 'docker'). Se so outro usuario acessa o Docker, use:" >&2
  echo "  ./install.sh --docker \"sudo -u <usuario> docker\"" >&2
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
