# Remote Control automático ao abrir o Claude Code

Data: 2026-11-02
Status: aprovado

## Contexto

Este é o primeiro de três subprojetos rumo a um assistente estilo "Jarvis":

1. **Remote Control automático** (este spec): toda sessão do Claude Code aberta pelo `llm-agent` fica acessível pelo celular (app Claude) e por claude.ai/code.
2. App desktop (Tauri nativo no Windows, UI web com visual de buraco negro, backend no WSL) para visualizar skills, memória e informações do projeto.
3. Conversa por voz com palavra de ativação, conversa contínua até "tchau" e tarefas em background.

O Claude Code (2.1.316) já tem a flag `claude --remote-control [nome]`, que abre a sessão interativa com o Remote Control ligado. Sem nome, a sessão é nomeada a partir do hostname. Dentro do container, o hostname é um ID aleatório, o que deixa a lista de sessões do celular ilegível.

## Objetivo

Ao abrir o Claude Code pelo `llm-agent`, a sessão já deve iniciar com o Remote Control ligado e com um nome que identifique o agente e o projeto.

## Comportamento

- Quando o comando executado no container é `claude`, o `llm-agent` acrescenta `--remote-control <nome>` aos argumentos. Isso vale para o menu (opção 1) e para `llm-agent claude [args]`.
- `<nome>` é o nome do container sem o prefixo `llm-agent-`. Exemplos: `claude-meu-app` e, numa segunda sessão no mesmo projeto, `claude-meu-app-2`.
- Se os argumentos do usuário já contiverem `--remote-control` (com ou sem valor, inclusive na forma `--remote-control=<nome>`), o script não acrescenta nada.
- Com `LLM_AGENT_NO_REMOTE_CONTROL=1` no ambiente, o script não acrescenta nada.
- `codex`, `zsh`, `--build` e qualquer outro comando não mudam.

## Mudanças

### `llm-agent`

- Calcular o nome do container uma vez, numa variável, antes do `compose run`. Hoje ele é calculado inline.
- Depois disso, se `$1` for `claude`, a variável `LLM_AGENT_NO_REMOTE_CONTROL` estiver vazia e nenhum argumento for `--remote-control` nem começar com `--remote-control=`, inserir `--remote-control "${name#llm-agent-}"` logo após `claude`, antes dos demais argumentos.
- Documentar `LLM_AGENT_NO_REMOTE_CONTROL` no cabeçalho de uso do script, que também é a saída de `--help`.

### `README.md`

Nova seção "Usando pelo celular (Remote Control)" com:

- o que acontece ao abrir o Claude Code e onde a sessão aparece (app Claude e claude.ai/code);
- o formato do nome da sessão;
- como desligar (`LLM_AGENT_NO_REMOTE_CONTROL=1`) e como escolher outro nome (`llm-agent claude --remote-control outro-nome`);
- o requisito: o Remote Control exige login com conta claude.ai e não funciona com API key.

## Tratamento de erros

O launcher não trata falhas do Remote Control, como falta de login ou de rede. Quem mostra o aviso é o próprio Claude Code, e a sessão local continua utilizável.

## Testes (manuais)

1. Pelo menu, opção 1: a sessão aparece no app do celular como `claude-<pasta>`.
2. `llm-agent claude`: mesmo resultado.
3. Segunda sessão no mesmo projeto, ao mesmo tempo: aparece como `claude-<pasta>-2`.
4. `llm-agent claude --remote-control teste`: aparece como `teste`, sem flag duplicada.
5. `LLM_AGENT_NO_REMOTE_CONTROL=1 llm-agent claude`: sem Remote Control.
6. `llm-agent codex` e `llm-agent zsh`: comportamento inalterado.
7. `bash -n llm-agent` e, se disponível, `shellcheck llm-agent` sem novos avisos.

## Fora de escopo

- Remote Control para o Codex.
- O modo servidor `claude remote-control` (spawn de várias sessões). Pode ser útil na etapa 3, para o Jarvis disparar tarefas, e será avaliado lá.
