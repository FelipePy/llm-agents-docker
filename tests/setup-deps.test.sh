#!/usr/bin/env bash
# Testa a verificacao e a instalacao das dependencias do app/setup.sh (check,
# install, install-root) com comandos falsos no PATH: docker, node, id,
# getent, apt-get, usermod, systemctl e curl. Nada de verdade e instalado.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" XDG_DATA_HOME="$work/home/.local/share" HF_HOME="$work/hf"
export LLM_AGENT_SYSTEMD_DIR="$work/systemd" LLM_AGENT_WSL_CONF="$work/wsl.conf" FAKE="$work/fake"
unset WSL_DISTRO_NAME
mkdir -p "$HOME" "$work/bin" "$FAKE"
real_node="$(command -v node)"
log="$work/calls"

failures=0
check() {
  if [ "$3" = "$2" ]; then echo "ok - $1"; else echo "FAIL - $1 (esperado: $2, obtido: $3)"; failures=$((failures + 1)); fi
}
fake() { # nome corpo
  printf '#!/usr/bin/env bash\n%s\n' "$2" >"$work/bin/$1"
  chmod +x "$work/bin/$1"
}
# Estado dos falsos: arquivos em $FAKE (docker=ok, image, node=<versao>, uid, groups...).
fake docker 'echo "docker $*" >>'"$log"'
case "$1" in
  --version) [ -f "$FAKE/docker" ] && echo "Docker version 27.0.1, build x" ;;
  compose|info) [ "$(cat "$FAKE/docker" 2>/dev/null)" = ok ] ;;
  image) [ -f "$FAKE/image" ] ;;
  *) exit 0 ;;
esac'
fake node '[ -f "$FAKE/node" ] || exit 127; echo "v$(cat "$FAKE/node")"'
fake id 'case "$1" in
  -u) if [ -n "${2:-}" ]; then grep -qx "$2" "$FAKE/users" 2>/dev/null; else cat "$FAKE/uid" 2>/dev/null || echo 1000; fi ;;
  -un) echo maria ;;
  -nG) echo "maria $(cat "$FAKE/groups" 2>/dev/null)" ;;
  *) [ -n "${2:-}" ] && grep -qx "$2" "$FAKE/users" 2>/dev/null ;;
esac'
fake getent 'cat "$FAKE/getent" 2>/dev/null'
for c in apt-get usermod useradd systemctl add-apt-repository; do fake "$c" "echo \"$c \$*\" >>$log"; done
fake nvidia-smi 'exit 1'
export PATH="$work/bin:$PATH"

item_state() { grep "\"id\":\"$1\"" | grep -o '"state":"[^"]*"' | cut -d'"' -f4; }
run() { bash "$repo_root/app/setup.sh" "$@" 2>>"$work/err"; }

# Maquina sem Docker nem Node.
out="$(run check)"
check "linha @env com o usuario" '@env {"user":"maria","distro":""}' "$(echo "$out" | head -1)"
check "docker ausente" missing "$(echo "$out" | item_state docker)"
check "node ausente" missing "$(echo "$out" | item_state node)"
check "imagem ausente" missing "$(echo "$out" | item_state image)"
check "voz ausente" missing "$(echo "$out" | item_state voice)"
check "sem pacote: nao lista o codigo" "" "$(echo "$out" | item_state app)"
check "cada item diz o motivo" "6" "$(echo "$out" | grep -c '"why":"[^"]\+"')"
check "itens que faltam dizem o que sera feito" "" "$(echo "$out" | grep '"state":"missing"' | grep '"action":""')"
check "cada item traz o tempo tipico (barra de progresso)" "6" "$(echo "$out" | grep -c '"secs":[1-9][0-9]*}')"
check "o JSON e valido" "ok" "$(echo "$out" | sed -n 's/^@item //p' | "$real_node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{s.trim().split("\n").forEach(l=>JSON.parse(l));console.log("ok")})' 2>&1)"

echo 18.19.0 >"$FAKE/node"
check "node antigo: desatualizado" outdated "$(run check | item_state node)"
echo 24.1.0 >"$FAKE/node"
echo ok >"$FAKE/docker"
touch "$FAKE/image"
out="$(run check)"
check "node 24: ok" ok "$(echo "$out" | item_state node)"
check "docker ok" ok "$(echo "$out" | item_state docker)"
check "imagem ok" ok "$(echo "$out" | item_state image)"

echo broken >"$FAKE/docker"
echo "docker:x:999:maria" >"$FAKE/getent"
check "no grupo docker, mas sem login novo: pede para sair e entrar" relogin "$(run check | item_state docker)"
rm -f "$FAKE/getent"

out="$(WSL_DISTRO_NAME=Ubuntu run check)"
check "WSL: @env traz a distribuicao" '"distro":"Ubuntu"' "$(echo "$out" | head -1 | grep -o '"distro":"[^"]*"')"
echo 0 >"$FAKE/uid"
out="$(WSL_DISTRO_NAME=Ubuntu run check)"
check "WSL entrando como root: so o usuario do Linux" "wsl-user" "$(echo "$out" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' ' | xargs)"

# Codigo do pacote: ausente, depois instalado (install app), depois desatualizado.
mkdir -p "$work/p/app/voice"
echo 2.0.0 >"$work/p/VERSION"
tar -C "$work/p" -czf "$work/p2.tar.gz" .
echo 1000 >"$FAKE/uid"
check "pacote: codigo ausente" missing "$(run check --payload "$work/p2.tar.gz" | item_state app)"
out="$(run install --payload "$work/p2.tar.gz" app)"
check "install app: passo comeca e termina" '@step {"id":"app","state":"start","message":""} @step {"id":"app","state":"ok","message":""}' "$(echo "$out" | grep '^@step' | tr '\n' ' ' | xargs -0 | sed 's/ $//')"
check "pacote instalado: ok" ok "$(run check --payload "$work/p2.tar.gz" | item_state app)"
echo 2.1.0 >"$work/p/VERSION"
tar -C "$work/p" -czf "$work/p21.tar.gz" .
check "pacote de outra versao: desatualizado" outdated "$(run check --payload "$work/p21.tar.gz" | item_state app)"

# Passo que falha: para ali, com a mensagem; os seguintes nao rodam.
out="$(run install --payload "$work/p2.tar.gz" image voice)"
check "passo que falha: devolve erro" "1" "$(run install --payload "$work/p2.tar.gz" image voice >/dev/null; echo $?)"
check "passo que falha: mensagem do erro" '"message":"Instale o llm-agents-docker antes. "' "$(echo "$out" | grep '"state":"fail"' | grep -o '"message":.*}' | sed 's/}$//')"
check "passo que falha: os seguintes nao rodam" "" "$(echo "$out" | grep '"id":"voice"')"

# Passos de root.
check "install-root sem root: recusa" "1" "$(run install-root --user maria base >/dev/null; echo $?)"
echo 0 >"$FAKE/uid"
check "install-root: recusa nome de usuario invalido" "1" "$(run install-root --user 'x;rm' base >/dev/null; echo $?)"
: >"$log"
mkdir -p "$LLM_AGENT_SYSTEMD_DIR"
out="$(run install-root --user maria base docker)"
check "base e docker pelo apt" "apt-get update -q|apt-get install -y -q git curl ca-certificates tar gzip|apt-get install -y -q docker.io|apt-get install -y -q docker-compose-v2|usermod -aG docker maria|systemctl enable --now docker" "$(grep -v '^docker ' "$log" | paste -sd'|')"
check "docker no Linux: novo no grupo pede login novo" "@restart logout" "$(echo "$out" | grep '^@restart')"

# Docker oficial (docker-ce) ja instalado, so parado: nao instala o docker.io por cima.
fake dockerd 'exit 0'
fake dpkg-query '[ "$3" = docker-ce ] && printf "install ok installed"'
check "docker instalado mas parado: a acao diz que so liga" "sim" "$(echo 1000 >"$FAKE/uid"; run check | grep '"id":"docker"' | grep -q 'já está instalado' && echo sim)"
echo 0 >"$FAKE/uid"
: >"$log"
echo broken >"$FAKE/docker"
run install-root --user maria docker >/dev/null
check "docker-ce instalado: so o plugin do compose, sem docker.io" "apt-get install -y -q docker-compose-plugin" "$(grep 'apt-get install' "$log" | paste -sd'|')"
echo ok >"$FAKE/docker"
: >"$log"
run install-root --user maria docker >/dev/null
check "docker e compose ja instalados: nenhum pacote" "" "$(grep 'apt-get install' "$log")"
# Servico do Docker ainda subindo: a verificacao espera ele responder.
echo 1000 >"$FAKE/uid"
mkdir -p "$LLM_AGENT_SYSTEMD_DIR"
echo broken >"$FAKE/docker"
fake systemctl 'echo "systemctl $*" >>'"$log"'; [ "$1" = is-active ] && { echo ok >"$FAKE/docker"; echo activating; }; exit 0'
check "docker subindo: espera e da ok" ok "$(run check | item_state docker)"
echo broken >"$FAKE/docker"
fake systemctl 'echo "systemctl $*" >>'"$log"'; [ "$1" = is-active ] && echo inactive; exit 0'
check "docker parado: nao espera, diz que falta" missing "$(run check | item_state docker)"
fake systemctl "echo \"systemctl \$*\" >>$log"
echo 0 >"$FAKE/uid"
rm -f "$work/bin/dockerd" "$work/bin/dpkg-query"

rm -rf "$LLM_AGENT_SYSTEMD_DIR"
out="$(WSL_DISTRO_NAME=Ubuntu run install-root --user maria docker)"
check "docker no WSL sem systemd: liga o systemd" "systemd=true" "$(grep -o 'systemd=true' "$LLM_AGENT_WSL_CONF")"
check "docker no WSL: reinicia a distribuicao" "@restart wsl" "$(echo "$out" | grep '^@restart' | sort -u)"

: >"$log"
out="$(WSL_DISTRO_NAME=Ubuntu run install-root --user maria wsl-user)"
check "usuario do WSL: cria e deixa como padrao" "useradd -m -s /bin/bash -G sudo maria|default=maria" "$(grep useradd "$log")|$(grep -o 'default=maria' "$LLM_AGENT_WSL_CONF")"
check "usuario do WSL: sem apt" "" "$(grep apt-get "$log")"

# Node: baixa de nodejs.org (aqui, um servidor falso), confere o SHA-256 e instala.
mkdir -p "$work/dist/node-v24.9.0-linux-x64/bin" "$work/dist/node-v24.9.0-linux-x64/"{include,lib,share}
printf '#!/bin/sh\necho v24.9.0\n' >"$work/dist/node-v24.9.0-linux-x64/bin/node"
chmod +x "$work/dist/node-v24.9.0-linux-x64/bin/node"
tar -C "$work/dist" -czf "$work/dist/node-v24.9.0-linux-x64.tar.gz" node-v24.9.0-linux-x64
(cd "$work/dist" && sha256sum node-v24.9.0-linux-x64.tar.gz >SHASUMS256.txt)
fake curl 'out=""; url=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done; cp "${url#file://}" "$out"'
export LLM_AGENT_NODE_DIST="file://$work/dist" LLM_AGENT_NODE_PREFIX="$work/usr"
run install-root --user maria node >/dev/null
check "node: instalado no prefixo" "v24.9.0" "$("$work/usr/bin/node" 2>/dev/null)"
echo corrompido >>"$work/dist/node-v24.9.0-linux-x64.tar.gz"
rm -rf "$work/usr"
check "node: download que nao confere e recusado" "1 nao" "$(run install-root --user maria node >/dev/null; echo $? $([ -e "$work/usr/bin/node" ] && echo sim || echo nao))"

[ "$failures" -eq 0 ] && echo "todos os testes passaram" || { echo "$failures falha(s)"; tail -20 "$work/err"; exit 1; }
