FROM node:24-bookworm-slim

ARG UID=1000
ARG GID=1000
ARG CODEX_VERSION=0.149.0
ARG CLAUDE_CODE_VERSION=2.1.285

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV SHELL=/usr/bin/zsh
ENV TERM=xterm-256color
ENV COLORTERM=truecolor
ENV BUN_INSTALL=/home/agent/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH
ENV PATH=/home/agent/.local/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fd-find \
        git \
        gnupg \
        jq \
        less \
        locales \
        nano \
        openssh-client \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        ripgrep \
        sudo \
        unzip \
        vim-tiny \
        zsh \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && npm install -g "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && python3 -m pip install --break-system-packages poetry \
    && existing_group="$(getent group "${GID}" | cut -d: -f1 || true)" \
    && if [ -n "${existing_group}" ]; then groupmod -n agent "${existing_group}"; else groupadd --gid "${GID}" agent; fi \
    && existing_user="$(getent passwd "${UID}" | cut -d: -f1 || true)" \
    && if [ -n "${existing_user}" ]; then usermod --login agent --home /home/agent --move-home --gid "${GID}" --shell /usr/bin/zsh "${existing_user}"; else useradd --uid "${UID}" --gid "${GID}" --create-home --shell /usr/bin/zsh agent; fi \
    && ln -sf "$(command -v fdfind)" /usr/local/bin/fd \
    && mkdir -p /workspace /attachments /home/agent/.codex /home/agent/.claude /home/agent/.config \
    && touch /home/agent/.zshrc \
    && chown -R agent:agent /workspace /attachments /home/agent \
    && echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent \
    && chmod 0440 /etc/sudoers.d/agent \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Versoes instaladas, lidas pelo llm-agent para checar atualizacoes.
LABEL llm-agent.claude-code="${CLAUDE_CODE_VERSION}" \
      llm-agent.codex="${CODEX_VERSION}"

USER agent
WORKDIR /workspace

CMD ["codex", "--dangerously-bypass-approvals-and-sandbox"]
