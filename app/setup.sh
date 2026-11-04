#!/usr/bin/env bash
# Instalacao do llm-agents-docker que vem dentro do app desktop (Jarvis). O app
# chama este script (no Windows, dentro do WSL) ao abrir; ninguem precisa
# clonar o repositorio nem rodar o install.sh.
#
# Uso:
#   setup.sh start [--payload ARQ] [--repo DIR] [--restart]
#       atualiza o codigo para o do pacote ARQ (se for de outra versao), sobe o
#       servidor da interface e imprime a URL na ultima linha. A primeira
#       instalacao nao e feita aqui: so com a aprovacao (setup.sh install app).
#       --repo DIR usa um clone do repositorio (desenvolvimento) em vez do pacote.
#   setup.sh deploy ARQ    so instala ou atualiza o codigo do pacote ARQ
#   setup.sh version       versao instalada (vazio se nenhuma)
#
# Dependencias (o app mostra a lista e so instala o que o usuario aprovar):
#   setup.sh check [--payload ARQ] [--repo DIR]
#       uma linha "@item {json}" por dependencia: id, state (ok, missing,
#       outdated, manual = o usuario resolve fora daqui, relogin = falta sair
#       e entrar de novo), title, why, action, size, root, found; e uma linha
#       "@env {json}" com o usuario e a distribuicao do WSL.
#   setup.sh install [--payload ARQ] [--repo DIR] ID...   passos do usuario
#   setup.sh install-root --user NOME ID...               passos de root (apt)
#       Cada passo: "@step {json}" com id, state (start, ok, fail) e message.
#       Para no primeiro que falhar; rodar de novo continua de onde parou.
#       "@restart wsl" (reiniciar a distribuicao) e "@restart logout" (sair e
#       entrar de novo) avisam o app.
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

# --- Dependencias ------------------------------------------------------------

image="local/llm-agent-safe:latest"
node_min="22.18"

json() { # texto -> string JSON
  local s="${1//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/ }"
  s="${s//$'\n'/ }"
  s="${s//$'\r'/ }"
  s="${s//$'\e'/}"
  printf '"%s"' "$s"
}
# item id estado titulo porque acao tamanho root encontrado
item() {
  printf '@item {"id":"%s","state":"%s","title":%s,"why":%s,"action":%s,"size":%s,"root":%s,"found":%s,"secs":%s}\n' \
    "$1" "$2" "$(json "$3")" "$(json "$4")" "$(json "$5")" "$(json "$6")" "$7" "$(json "${8:-}")" "$(item_secs "$1")"
}
# Tempo tipico de cada passo, em segundos (a barra de progresso do app estima o restante com ele).
item_secs() {
  case "$1" in
    wsl-user) echo 10 ;;
    base) echo 30 ;;
    docker) echo 90 ;;
    node) echo 40 ;;
    python) echo 60 ;;
    app) echo 15 ;;
    image) echo 420 ;;
    voice) if gpu; then echo 600; else echo 150; fi ;;
    *) echo 30 ;;
  esac
}
step() { printf '@step {"id":"%s","state":"%s","message":%s}\n' "$1" "$2" "$(json "${3:-}")"; }

in_wsl() { [ -n "${WSL_DISTRO_NAME:-}" ]; }
systemd_running() { [ -d "${LLM_AGENT_SYSTEMD_DIR:-/run/systemd/system}" ]; }
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

# Primeiro Python >= 3.10 com venv (o mesmo criterio de app/voice/setup.sh).
find_python() {
  local c
  for c in ${LLM_AGENT_PYTHON:-} python3 python3.13 python3.12 python3.11 python3.10; do
    "$c" -c 'import sys, venv, ensurepip; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1 && { echo "$c"; return 0; }
  done
  return 1
}

docker_ok() { docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
# Docker instalado, mas o servico ainda subindo (distribuicao do WSL recem-iniciada):
# espera ate ~15 s antes de dizer que ele nao responde.
docker_ok_wait() {
  docker_ok && return 0
  command -v dockerd >/dev/null && systemd_running || return 1
  local _
  for _ in $(seq 1 "${LLM_AGENT_DOCKER_WAIT:-15}"); do
    case "$(systemctl is-active docker 2>/dev/null)" in active | activating) ;; *) return 1 ;; esac
    sleep 1
    docker_ok && return 0
  done
  return 1
}
# O usuario ja esta no grupo docker, mas esta sessao ainda nao (falta um login novo).
docker_needs_relogin() {
  getent group docker 2>/dev/null | cut -d: -f4 | tr ',' '\n' | grep -qx "$(id -un)" && ! id -nG | tr ' ' '\n' | grep -qx docker
}
# docker do Docker Desktop (Windows) no WSL: quem liga e o proprio Docker Desktop.
docker_desktop() { readlink -f "$(command -v docker 2>/dev/null)" 2>/dev/null | grep -q 'docker-desktop\|^/mnt/wsl/\|^/mnt/[a-z]/'; }

# Codigo em uso: o clone (--repo) ou a instalacao do pacote.
code_dir() { if [ -n "${repo:-}" ]; then echo "$repo"; else echo "$current"; fi; }
gpu() { command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; }
whisper_model() { if gpu; then echo small; else echo base; fi; }
whisper_ready() { [ -d "${HF_HOME:-$HOME/.cache/huggingface}/hub/models--Systran--faster-whisper-$(whisper_model)/snapshots" ]; }

check() {
  local found v py
  printf '@env {"user":%s,"distro":%s}\n' "$(json "$(id -un)")" "$(json "${WSL_DISTRO_NAME:-}")"
  # Ubuntu recem-instalado no WSL sem usuario (entra como root): o app cria um antes do resto.
  if in_wsl && [ "$(id -u)" = 0 ]; then
    item wsl-user missing "Usuário do Linux" \
      "Os agentes e o servidor rodam com um usuário comum, não como administrador (root)." \
      "Cria o seu usuário no Linux (sem senha; defina uma depois com passwd) e o deixa como padrão do WSL." "" true
    return 0
  fi

  if command -v git >/dev/null && command -v curl >/dev/null && command -v tar >/dev/null; then
    item base ok "git e curl" "Baixar o que falta e guardar as versões do Jarvis (evolução)." "" "" true
  else
    item base missing "git e curl" "Baixar o que falta e guardar as versões do Jarvis (evolução)." \
      "Instala git, curl e certificados pelo apt." "~10 MB" true
  fi

  found="$(docker --version 2>/dev/null | sed 's/,.*//' || true)"
  if docker_ok_wait; then
    item docker ok "Docker e docker compose" "Os agentes rodam em containers isolados, um por projeto." "" "" true "$found"
  elif docker_needs_relogin; then
    item docker relogin "Docker e docker compose" "Os agentes rodam em containers isolados, um por projeto." \
      "Seu usuário já está no grupo docker, mas isso só vale numa sessão nova: saia e entre de novo (ou reinicie o computador)." "" false "$found"
  elif in_wsl && docker_desktop; then
    item docker manual "Docker e docker compose" "Os agentes rodam em containers isolados, um por projeto." \
      "O Docker daqui é o do Docker Desktop: abra o Docker Desktop no Windows e ligue a integração com esta distribuição (Settings > Resources > WSL integration)." "" false "$found"
  else
    local wsl_note=""
    in_wsl && ! systemd_running && wsl_note=" (liga o systemd no WSL, que reinicia a distribuição)"
    if command -v dockerd >/dev/null; then
      item docker missing "Docker e docker compose" "Os agentes rodam em containers isolados, um por projeto." \
        "O Docker já está instalado, mas não responde: liga o serviço, põe seu usuário no grupo docker e instala o docker compose se faltar$wsl_note." "" true "$found"
    else
      item docker missing "Docker e docker compose" "Os agentes rodam em containers isolados, um por projeto." \
        "Instala o Docker Engine e o docker compose pelo apt, liga o serviço e põe seu usuário no grupo docker$wsl_note." "~100 MB" true "$found"
    fi
  fi

  v="$(node -v 2>/dev/null | sed 's/^v//' || true)"
  if [ -n "$v" ] && version_ge "$v" "$node_min"; then
    item node ok "Node.js" "Roda o servidor da interface e do Jarvis." "" "" true "$v"
  else
    item node "$([ -n "$v" ] && echo outdated || echo missing)" "Node.js" "Roda o servidor da interface e do Jarvis (precisa do $node_min ou mais novo)." \
      "Baixa o Node 24 de nodejs.org (conferindo o SHA-256) e instala em /usr/local." "~30 MB" true "$v"
  fi

  if py="$(find_python)"; then
    item python ok "Python com venv" "Roda a voz (palavra de ativação, transcrição e fala)." "" "" true "$("$py" --version 2>&1)"
  else
    v="$(python3 --version 2>/dev/null || true)"
    item python "$([ -n "$v" ] && echo outdated || echo missing)" "Python com venv" \
      "Roda a voz (palavra de ativação, transcrição e fala); precisa do 3.10 ou mais novo, com venv." \
      "Instala o Python 3 e o venv pelo apt (num Ubuntu antigo, o Python 3.12 do PPA deadsnakes)." "~50 MB" true "$v"
  fi

  if [ -n "${payload:-}" ] && [ -z "${repo:-}" ]; then
    local want have
    want="$(payload_version "$payload")"
    have="$(installed_version)"
    if [ "$have" = "$want" ] || [ "$(cat "$root/failed-version" 2>/dev/null)" = "$want" ]; then
      item app ok "llm-agents-docker" "O código do Jarvis: o comando llm-agent, o servidor, a interface e a voz." "" "" false "$have"
    else
      item app "$([ -n "$have" ] && echo outdated || echo missing)" "llm-agents-docker $want" \
        "O código do Jarvis: o comando llm-agent, o servidor, a interface e a voz." \
        "Copia o código que veio no instalador para ~/.local/share/llm-agent e cria o comando llm-agent (nada é baixado)." "~385 MB em disco" false "$have"
    fi
  fi

  if docker image inspect "$image" >/dev/null 2>&1; then
    item image ok "Imagem dos agentes" "O container onde o Claude Code e o Codex rodam, vendo só o projeto." "" "" false
  else
    item image missing "Imagem dos agentes" "O container onde o Claude Code e o Codex rodam, vendo só o projeto." \
      "Constrói a imagem $image (llm-agent --build) com o seu usuário." "~1 GB de download" false
  fi

  local venv
  venv="$(code_dir)/app/voice/.venv"
  [ -n "${repo:-}" ] || venv="$root/voice-venv"
  if [ -f "$venv/.installed" ] && [ -f "$venv/models/wespeaker_en_voxceleb_resnet34.onnx" ] && whisper_ready; then
    item voice ok "Voz do Jarvis" "Ouvir \"Jarvis\", transcrever o que você fala e responder em voz alta." "" "" false
  else
    item voice missing "Voz do Jarvis" "Ouvir \"Jarvis\", transcrever o que você fala e responder em voz alta." \
      "Cria o ambiente Python da voz e baixa os modelos: whisper $(whisper_model) (transcrição), palavra de ativação e reconhecimento da sua voz." \
      "$(if gpu; then echo '~2,5 GB (com as bibliotecas CUDA da GPU NVIDIA)'; else echo '~450 MB de download (~850 MB em disco)'; fi)" false
  fi
}

apt_install() { DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$@"; }
dpkg_has() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

root_step() { # id usuario
  case "$1" in
    wsl-user)
      id -u "$2" >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo "$2"
      local conf="${LLM_AGENT_WSL_CONF:-/etc/wsl.conf}"
      grep -q '^\[user\]' "$conf" 2>/dev/null || printf '\n[user]\ndefault=%s\n' "$2" >>"$conf"
      echo "@restart wsl"
      ;;
    base) apt_install git curl ca-certificates tar gzip ;;
    docker)
      if command -v dockerd >/dev/null; then
        # Docker ja instalado (so parado ou sem acesso): nao instala outro por cima. O
        # docker.io do Ubuntu conflita com o Docker oficial (containerd x containerd.io).
        if ! docker compose version >/dev/null 2>&1; then
          if dpkg_has docker-ce || dpkg_has docker-ce-cli; then apt_install docker-compose-plugin; else apt_install docker-compose-v2; fi
        fi
      else
        apt_install docker.io
        apt_install docker-compose-v2 || apt_install docker-compose-plugin
      fi
      local was_member=""
      getent group docker | cut -d: -f4 | tr ',' '\n' | grep -qx "$2" && was_member=1
      usermod -aG docker "$2"
      if systemd_running; then
        systemctl enable --now docker
      elif in_wsl; then
        # Sem systemd o Docker nao sobe sozinho: liga o systemd (vale ao reiniciar a distribuicao).
        local conf="${LLM_AGENT_WSL_CONF:-/etc/wsl.conf}"
        grep -q '^systemd=true' "$conf" 2>/dev/null || printf '\n[boot]\nsystemd=true\n' >>"$conf"
        echo "@restart wsl"
      fi
      if [ -z "$was_member" ]; then if in_wsl; then echo "@restart wsl"; else echo "@restart logout"; fi; fi
      ;;
    node)
      local dist="${LLM_AGENT_NODE_DIST:-https://nodejs.org/dist/latest-v24.x}" prefix="${LLM_AGENT_NODE_PREFIX:-/usr/local}" tmp file
      tmp="$(mktemp -d)"
      curl -fsSL "$dist/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
      file="$(grep -o 'node-v[0-9.]*-linux-x64.tar.gz' "$tmp/SHASUMS256.txt" | head -1)"
      [ -n "$file" ] || { rm -rf "$tmp"; echo "Não achei o Node para Linux x64 em $dist." >&2; return 1; }
      curl -fsSL "$dist/$file" -o "$tmp/$file"
      (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -) || { rm -rf "$tmp"; echo "O download do Node não confere (SHA-256)." >&2; return 1; }
      mkdir -p "$tmp/node" "$prefix"
      tar -xzf "$tmp/$file" -C "$tmp/node" --strip-components=1
      cp -a "$tmp/node/bin" "$tmp/node/include" "$tmp/node/lib" "$tmp/node/share" "$prefix/"
      rm -rf "$tmp"
      ;;
    python)
      apt_install python3 python3-venv python3-pip
      if ! find_python >/dev/null; then
        apt_install software-properties-common
        add-apt-repository -y ppa:deadsnakes/ppa
        apt-get update -q
        apt_install python3.12 python3.12-venv
      fi
      ;;
    *) echo "Passo desconhecido: $1" >&2; return 1 ;;
  esac
}

user_step() { # id
  local code
  code="$(code_dir)"
  case "$1" in
    app)
      [ -n "${payload:-}" ] || { echo "Sem o pacote do instalador." >&2; return 1; }
      deploy "$payload"
      ;;
    image)
      [ -x "$code/llm-agent" ] || { echo "Instale o llm-agents-docker antes." >&2; return 1; }
      if docker info >/dev/null 2>&1; then
        LLM_AGENT_NO_UPDATE_CHECK=1 "$code/llm-agent" --build >&2
      else
        # Acabou de entrar no grupo docker: o grupo vale nesta chamada com o sg.
        sg docker -c "LLM_AGENT_NO_UPDATE_CHECK=1 $(printf '%q' "$code/llm-agent") --build" >&2
      fi
      ;;
    voice)
      local voice="$code/app/voice" py
      [ -f "$voice/setup.sh" ] || { echo "Instale o llm-agents-docker antes." >&2; return 1; }
      py="$(find_python)" || { echo "Instale o Python antes." >&2; return 1; }
      LLM_AGENT_PYTHON="$py" bash "$voice/setup.sh" >&2
      (cd "$voice" && .venv/bin/python -c '
import sys
from faster_whisper import download_model
from jarvis_voice.speaker import SpeakerModel
download_model(sys.argv[1])
SpeakerModel(".venv/models")._load()
' "$(whisper_model)") >&2
      ;;
    *) echo "Passo desconhecido: $1" >&2; return 1 ;;
  esac
}

# Roda os passos na ordem; para no primeiro que falhar. Cada passo roda num
# subshell com set -e (dentro de um "if" ele ficaria desligado); o stderr vai
# para o app e para um arquivo, de onde sai a mensagem de erro.
run_steps() { # funcao id...
  local fn="$1" id err rc
  shift
  for id in "$@"; do
    step "$id" start
    err="$(mktemp)"
    set +e
    { (set -e; "$fn" "$id" 2>&1 >&3) | tee "$err" >&2; } 3>&1
    rc=$?
    set -e
    if [ "$rc" -eq 0 ]; then
      step "$id" ok
    else
      step "$id" fail "$(grep -v '^[[:space:]]*$' "$err" | tail -n 3 | tr '\n' ' ')"
      rm -f "$err"
      return 1
    fi
    rm -f "$err"
  done
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
      # Atualizar o que o usuario ja instalou vem com o app novo; instalar do zero, nao.
      [ -z "$payload" ] || [ -z "$(installed_version)" ] || deploy "$payload"
      ui="$current/app/ui.sh"
      [ -x "$ui" ] || die "O Jarvis não está instalado (pacote ausente). Reinstale o app."
    fi
    if [ -n "$restart" ]; then "$ui" --stop >/dev/null 2>&1 || true; fi
    status "Iniciando o servidor…"
    exec "$ui"
    ;;
  check | install)
    payload="" repo="" ids=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --payload) payload="$(to_path "${2:?--payload precisa de um arquivo}")"; shift 2 ;;
        --repo) repo="$(to_path "${2:?--repo precisa de uma pasta}")"; shift 2 ;;
        -*) die "setup.sh $cmd: opção desconhecida: $1" ;;
        *) ids+=("$1"); shift ;;
      esac
    done
    if [ "$cmd" = check ]; then check; else run_steps user_step "${ids[@]}"; fi
    ;;
  install-root)
    [ "${1:-}" = "--user" ] && [ -n "${2:-}" ] || die "uso: setup.sh install-root --user NOME ID..."
    user="$2"
    shift 2
    [ "$(id -u)" = 0 ] || die "setup.sh install-root precisa de root."
    case "$user" in root | *[!a-z0-9_-]*) die "Nome de usuário inválido: $user" ;; esac
    if [ "$*" != "wsl-user" ]; then
      command -v apt-get >/dev/null || die "Só sei instalar com o apt (Ubuntu/Debian). Instale à mão: $*"
      apt-get update -q >&2
    fi
    root_one() { root_step "$1" "$user"; }
    run_steps root_one "$@"
    ;;
  -h | --help | "") sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "$0" ;;
  *) die "setup.sh: comando desconhecido: $cmd" ;;
esac
