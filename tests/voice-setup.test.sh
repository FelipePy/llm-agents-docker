#!/usr/bin/env bash
# Testa a escolha do Python em app/voice/setup.sh, com Pythons falsos num PATH
# isolado: nada e instalado e o Python real da maquina nao interfere.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

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

# Cria um cenario novo: copia do setup.sh e um PATH so com as ferramentas dele.
scenario() {
  dir="$work/$1"
  bin="$dir/bin"
  voice="$dir/voice"
  mkdir -p "$bin" "$voice"
  cp "$repo/app/voice/setup.sh" "$repo/app/voice/requirements.txt" "$repo/app/voice/requirements-nodeps.txt" "$voice/"
  for tool in bash env cat sha256sum cut dirname mkdir chmod; do
    ln -s "$(command -v "$tool")" "$bin/$tool"
  done
}

# Python falso: responde a versao e, se a versao servir, cria o .venv e anota
# quem criou. "sem-venv" como terceiro argumento simula a falta do modulo venv.
fake_python() { # nome versao [sem-venv]
  local minor="${2#3.}"
  minor="${minor%%.*}"
  cat >"$bin/$1" <<FAKE
#!/usr/bin/env bash
case "\$1" in
  --version) echo "Python $2" ;;
  -c) [ "$minor" -ge 10 ] ;;
  -m)
    [ "${3:-}" != sem-venv ] || exit 1
    mkdir -p "\$3/bin"
    printf '#!/usr/bin/env bash\nexit 0\n' >"\$3/bin/python"
    chmod +x "\$3/bin/python"
    echo "$1" >"$dir/venv-criado-por"
    ;;
esac
FAKE
  chmod +x "$bin/$1"
}

run_setup() { # [LLM_AGENT_PYTHON]
  PATH="$bin" LLM_AGENT_PYTHON="${1:-}" "$bin/bash" "$voice/setup.sh" >"$dir/out" 2>&1
  code=$?
}
chosen() { cat "$dir/venv-criado-por" 2>/dev/null; }

scenario python3-novo
fake_python python3 3.12.3
fake_python python3.13 3.13.0
run_setup
check "python3 novo: sai com sucesso" 0 "$code"
check "python3 novo: tem prioridade" python3 "$(chosen)"

scenario python3-antigo
fake_python python3 3.8.10
fake_python python3.12 3.12.11
run_setup
check "python3 antigo: sai com sucesso" 0 "$code"
check "python3 antigo: usa a versao instalada ao lado" python3.12 "$(chosen)"

scenario sem-python3
fake_python python3.11 3.11.9
run_setup
check "sem python3: sai com sucesso" 0 "$code"
check "sem python3: usa a versao encontrada" python3.11 "$(chosen)"

scenario so-antigo
fake_python python3 3.8.10
run_setup
check "so Python antigo: codigo 2" 2 "$code"
check "so Python antigo: diz a versao encontrada" \
  "A voz precisa de Python 3.10 ou mais novo (encontrado: Python 3.8.10)." "$(cat "$dir/out")"

scenario nenhum
run_setup
check "nenhum Python: codigo 2" 2 "$code"
check "nenhum Python: mensagem curta" \
  "A voz precisa de Python 3.10 ou mais novo (encontrado: nenhum)." "$(cat "$dir/out")"

scenario variavel
fake_python python3 3.12.3
fake_python python3.11 3.11.9
run_setup python3.11
check "LLM_AGENT_PYTHON: sai com sucesso" 0 "$code"
check "LLM_AGENT_PYTHON: tem prioridade sobre o python3" python3.11 "$(chosen)"

scenario variavel-antiga
fake_python python3 3.12.3
fake_python python3.9 3.9.1
run_setup python3.9
check "LLM_AGENT_PYTHON antigo: nao troca por outro" 2 "$code"
check "LLM_AGENT_PYTHON antigo: diz a versao dele" \
  "A voz precisa de Python 3.10 ou mais novo (encontrado: Python 3.9.1)." "$(cat "$dir/out")"

scenario sem-venv
fake_python python3 3.8.10
fake_python python3.12 3.12.11 sem-venv
run_setup
check "sem venv: codigo 3" 3 "$code"
check "sem venv: indica o pacote da versao escolhida" \
  "Nao consegui criar o ambiente virtual. No Ubuntu/Debian: sudo apt install python3.12-venv" "$(cat "$dir/out")"

if [ "$failures" -gt 0 ]; then
  echo "$failures falha(s)"
  exit 1
fi
echo "tudo certo"
