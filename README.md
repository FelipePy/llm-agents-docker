# Para executar o container com codex, use:

UID=$(id -u) GID=$(id -g) CODEX_WORKDIR="$PWD/<projeto>" docker compose -f docker-compose.codex.yml run --rm codex
