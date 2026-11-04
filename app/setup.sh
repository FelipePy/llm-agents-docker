#!/usr/bin/env bash
# Instalacao do llm-agents-docker que vem dentro do app desktop (Jarvis). O app
# chama este script (no Windows, dentro do WSL) ao abrir; ninguem precisa
# clonar o repositorio nem rodar o install.sh.
#
# Uso:
#   setup.sh start [--payload ARQ] [--repo DIR] [--restart]
#       instala ou atualiza o codigo do pacote ARQ (se for de outra versao),
#       sobe o servidor da interface e imprime a URL na ultima linha.
#       --repo DIR usa um clone do repositorio (desenvolvimento) em vez do pacote.
#   setup.sh deploy ARQ    so instala ou atualiza o codigo do pacote ARQ
#   setup.sh version       versao instalada (vazio se nenhuma)
#
# O pacote (.tar.gz) traz o repositorio com a interface ja construida e as
# dependencias do servidor. Cada versao fica em sua pasta, com um link
# "current" para a que esta em uso:
#   ~/.local/share/llm-agent/versions/<versao>   (LLM_AGENT_HOME muda a raiz)
#   ~/.local/share/llm-agent/current -> versions/<versao>
#   ~/.local/share/llm-agent/voice-venv          ambiente da voz, entre versoes
# Atualizar com o servidor no ar usa o reinicio verificado (app/restart.sh
# --switch): se a versao nova nao subir, o link volta para a anterior.
#
# Linhas que comecam com "@status " sao o progresso, mostrado pelo app.
set -euo pipefail

root="${LLM_AGENT_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/llm-agent}"
bin_dir="${LLM_AGENT_BIN_DIR:-$HOME/.local/bin}"
current="$root/current"

status() { echo "@status $*"; }
die() { echo "$*" >&2; exit 1; }

# Caminho do Windows (C:\...) vira o do WSL (/mnt/c/...).
to_path() {
  case "$1" in
    [A-Za-z]:\\* | \\\\*) wslpath -u "$1" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

installed_version() { cat "$current/VERSION" 2>/dev/null | tr -d '[:space:]' || true; }
payload_version() { tar -xzOf "$1" ./VERSION 2>/dev/null | tr -d '[:space:]'; }

# Pid do servidor da interface que estiver no ar (vazio se nenhum).
server_pid() {
  local state="${XDG_CONFIG_HOME:-$HOME/.config}/llm-agent/ui/server.json" pid
  pid="$(grep -o '"pid":[0-9]*' "$state" 2>/dev/null | cut -d: -f2)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
  return 0
}

# Deixa no maximo duas versoes (a atual e a anterior, para voltar).
prune() {
  local keep_a keep_b dir
  keep_a="$(readlink -f "$current")"
  keep_b="${1:+$(readlink -f "$1")}"
  for dir in "$root"/versions/*; do
    [ -d "$dir" ] || continue
    dir="$(readlink -f "$dir")"
    if [ "$dir" != "$keep_a" ] && [ "$dir" != "$keep_b" ]; then rm -rf "$dir"; fi
  done
}

link_command() {
  local target="$bin_dir/llm-agent"
  mkdir -p "$bin_dir"
  # Um llm-agent de outro lugar (um clone com install.sh) fica como esta.
  if [ -e "$target" ] || [ -L "$target" ]; then
    case "$(readlink "$target" 2>/dev/null || true)" in
      "$root"/*) ;;
      *) return 0 ;;
    esac
  fi
  ln -sfn "$current/llm-agent" "$target"
}

deploy() {
  local payload="$1" version dest previous
  [ -f "$payload" ] || die "Pacote do Jarvis não encontrado: $payload"
  version="$(payload_version "$payload")"
  [ -n "$version" ] || die "Pacote do Jarvis inválido (sem VERSION): $payload"
  if [ "$(installed_version)" = "$version" ] && [ -f "$current/.jarvis-complete" ]; then
    link_command
    return 0
  fi
  # Esta versao ja falhou nas verificacoes: fica na anterior ate vir outro instalador.
  if [ -n "$(installed_version)" ] && [ "$(cat "$root/failed-version" 2>/dev/null)" = "$version" ]; then
    echo "A versão $version não passou nas verificações antes; o Jarvis segue na $(installed_version)." >&2
    return 0
  fi

  if [ -n "$(installed_version)" ]; then status "Atualizando o Jarvis para a versão $version…"; else status "Instalando o Jarvis $version…"; fi
  dest="$root/versions/$version"
  mkdir -p "$root/versions" "$root/voice-venv"
  rm -rf "$dest.tmp"
  mkdir -p "$dest.tmp"
  tar -xzf "$payload" -C "$dest.tmp"
  # O ambiente da voz (pacotes e modelos, centenas de MB) fica fora da versao.
  rm -rf "$dest.tmp/app/voice/.venv"
  ln -s "$root/voice-venv" "$dest.tmp/app/voice/.venv"
  # Um repositorio git local: a evolucao do Jarvis (clone, merge, volta) precisa dele.
  if command -v git >/dev/null; then
    git -C "$dest.tmp" init -q -b main
    git -C "$dest.tmp" add -A
    git -C "$dest.tmp" -c user.name=Jarvis -c user.email=jarvis@localhost commit -q -m "Jarvis $version" || true
  fi
  touch "$dest.tmp/.jarvis-complete"
  rm -rf "$dest"
  mv "$dest.tmp" "$dest"

  previous=""
  [ -L "$current" ] && previous="$(readlink -f "$current")"
  [ "$previous" = "$dest" ] && previous=""
  ln -sfn "$dest" "$current.new"
  mv -T "$current.new" "$current"
  link_command

  # Atualizacao: reinicio verificado, com volta para a versao anterior se falhar. Um
  # servidor de outro lugar no ar (um clone em desenvolvimento) fica como esta.
  local pid
  pid="$(server_pid)"
  if [ -n "$previous" ] && { [ -z "$pid" ] || tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -qF "$previous/"; }; then
    status "Reiniciando o servidor na versão $version…"
    LLM_AGENT_RESTART_DELAY=0 LLM_AGENT_RESTART_UI="$current/app/ui.sh" \
      bash "$dest/app/restart.sh" --switch "$current" "$previous" >&2 ||
      die "A versão $version não subiu, e a anterior também falhou: rode $current/llm-agent ui para ver o erro."
    if [ "$(readlink -f "$current")" != "$dest" ]; then
      echo "$version" >"$root/failed-version"
      echo "A versão $version não passou nas verificações; o Jarvis continua na versão anterior." >&2
    fi
  fi
  prune "$previous"
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  version) installed_version ;;
  deploy)
    [ $# -eq 1 ] || die "uso: setup.sh deploy <pacote.tar.gz>"
    deploy "$(to_path "$1")"
    ;;
  start)
    payload="" repo="" restart=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --payload) payload="$(to_path "${2:?--payload precisa de um arquivo}")"; shift 2 ;;
        --repo) repo="$(to_path "${2:?--repo precisa de uma pasta}")"; shift 2 ;;
        --restart) restart=1; shift ;;
        *) die "setup.sh start: opção desconhecida: $1" ;;
      esac
    done
    if [ -n "$repo" ]; then
      ui="$repo/app/ui.sh"
      [ -x "$ui" ] || die "Repositório de desenvolvimento sem app/ui.sh: $repo"
    else
      [ -z "$payload" ] || deploy "$payload"
      ui="$current/app/ui.sh"
      [ -x "$ui" ] || die "O Jarvis não está instalado (pacote ausente). Reinstale o app."
    fi
    if [ -n "$restart" ]; then "$ui" --stop >/dev/null 2>&1 || true; fi
    status "Iniciando o servidor…"
    exec "$ui"
    ;;
  -h | --help | "") sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "$0" ;;
  *) die "setup.sh: comando desconhecido: $cmd" ;;
esac
