#!/usr/bin/env bash
# Prepara o ambiente Python da voz em app/voice/.venv. Idempotente: so
# reinstala quando os requisitos mudam e recria o ambiente quando a versao do
# Python muda. Codigos de saida: 2 = Python antigo, 3 = sem venv, 1 = falha na
# instalacao.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
venv="$dir/.venv"

# Python usado: o de LLM_AGENT_PYTHON, se definido (sem troca-lo por outro); senao
# o python3 e, se ele for antigo (como no Ubuntu 20.04), uma versao instalada ao
# lado dele. A 3.12 vem antes das demais por ser a testada no CI.
if [ -n "${LLM_AGENT_PYTHON:-}" ]; then
  candidates=("$LLM_AGENT_PYTHON")
else
  candidates=(python3 python3.12 python3.13 python3.14 python3.11 python3.10)
fi
py=""
for candidate in "${candidates[@]}"; do
  if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    py="$candidate"
    break
  fi
done
if [ -z "$py" ]; then
  found="nenhum"
  if command -v "${candidates[0]}" >/dev/null 2>&1; then
    found="$("${candidates[0]}" --version 2>&1 || echo nenhum)"
  fi
  echo "A voz precisa de Python 3.10 ou mais novo (encontrado: $found)." >&2
  exit 2
fi

# GPU NVIDIA (no WSL, com o driver do Windows): instala as bibliotecas CUDA do
# whisper (cuBLAS e cuDNN) dentro do ambiente; o servidor aponta o worker para elas.
gpu=""
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  gpu="cuda12"
fi

version_of() { "$1" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null; }

# O bin/python do ambiente aponta para o Python do sistema, mas os pacotes ficam em
# lib/python3.X: uma atualizacao que troca a versao deixa o ambiente sem os pacotes,
# mesmo com o carimbo em dia. So vale o ambiente da versao escolhida acima.
py_version="$(version_of "$py")"
venv_ok() {
  [ "$(version_of "$venv/bin/python")" = "$py_version" ] && [ -d "$venv/lib/python$py_version/site-packages" ]
}

want="$(cat "$dir/requirements.txt" "$dir/requirements-nodeps.txt" | sha256sum | cut -d' ' -f1)-$gpu"
if venv_ok && [ -f "$venv/.installed" ] && [ "$(cat "$venv/.installed")" = "$want" ]; then
  exit 0
fi

if ! venv_ok; then
  if [ -e "$venv/pyvenv.cfg" ]; then
    echo "O ambiente da voz nao serve para o Python $py_version: recriando..." >&2
  fi
  if ! "$py" -m venv --clear "$venv"; then
    echo "Nao consegui criar o ambiente virtual. No Ubuntu/Debian: sudo apt install ${py##*/}-venv" >&2
    exit 3
  fi
fi

"$venv/bin/python" -m pip install -q --upgrade pip
"$venv/bin/python" -m pip install -q -r "$dir/requirements.txt"
"$venv/bin/python" -m pip install -q --no-deps -r "$dir/requirements-nodeps.txt"
if [ -n "$gpu" ]; then
  echo "GPU NVIDIA encontrada: instalando as bibliotecas CUDA do whisper..." >&2
  "$venv/bin/python" -m pip install -q "nvidia-cublas-cu12" "nvidia-cudnn-cu12==9.*" ||
    echo "Nao consegui instalar as bibliotecas CUDA; a transcricao vai usar a CPU." >&2
fi
"$venv/bin/python" -c 'import openwakeword.utils as u; u.download_models(["hey_jarvis"])'
echo "$want" > "$venv/.installed"
