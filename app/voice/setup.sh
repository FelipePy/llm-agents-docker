#!/usr/bin/env bash
# Prepara o ambiente Python da voz em app/voice/.venv. Idempotente: so
# reinstala quando os requisitos mudam. Codigos de saida: 2 = Python antigo,
# 3 = sem venv, 1 = falha na instalacao.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
venv="$dir/.venv"

# O primeiro Python >= 3.10 (LLM_AGENT_PYTHON, python3 ou um python3.X ao lado de um
# python3 antigo, como o python3.12 que o instalador do Jarvis poe no Ubuntu 20.04).
py=""
for candidate in ${LLM_AGENT_PYTHON:-} python3 python3.13 python3.12 python3.11 python3.10; do
  if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    py="$candidate"
    break
  fi
done
if [ -z "$py" ]; then
  echo "A voz precisa de Python 3.10 ou mais novo (encontrado: $(python3 --version 2>&1 || echo nenhum))." >&2
  exit 2
fi

# GPU NVIDIA (no WSL, com o driver do Windows): instala as bibliotecas CUDA do
# whisper (cuBLAS e cuDNN) dentro do ambiente; o servidor aponta o worker para elas.
gpu=""
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  gpu="cuda12"
fi

want="$(cat "$dir/requirements.txt" "$dir/requirements-nodeps.txt" | sha256sum | cut -d' ' -f1)-$gpu"
if [ -f "$venv/.installed" ] && [ "$(cat "$venv/.installed")" = "$want" ]; then
  exit 0
fi

# O .venv pode ser um link (instalacao do app desktop: o ambiente fica fora da versao),
# e o venv nao cria o ambiente atraves de um link: cria no destino dele.
if [ ! -x "$venv/bin/python" ] && ! "$py" -m venv "$(readlink -f "$venv")"; then
  echo "Nao consegui criar o ambiente virtual. No Ubuntu/Debian: sudo apt install python3-venv" >&2
  exit 3
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
