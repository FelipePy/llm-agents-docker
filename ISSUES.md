# Issues

Tarefas do projeto, registradas aqui porque as issues do fork no GitHub estão desativadas. Uma issue concluída é apagada
desta lista.

## Pendentes

### 3. Nome e voz do assistente
- Definir outro nome para o assistente nas configurações, com a palavra de ativação acompanhando o nome novo.
- Mais opções de voz para selecionar, com prévia.

**Situação:** pendente; nenhum sinal no código da interface.

### 4. Avisar o usuário quando a sessão pedir decisão
Quando uma sessão de agente pedir uma decisão do usuário, o Jarvis deve avisar por voz logo, sem esperar o usuário perguntar. Também deve haver um filtro para que as respostas do Jarvis sejam rápidas.

**Situação:** pendente.

### 5. Resumo do que foi feito ao fim de uma sessão
Quando o terminal termina uma tarefa, o Jarvis lê só a última linha exibida no terminal e a fala. O comportamento esperado é trazer um resumo do que foi feito na sessão.

**Situação:** pendente.

### 6. Frase de tarefas em background para sessões e subtarefas do Claude
Aprimorar a frase que informa quantas tarefas estão rodando em background (ex.: x tarefas rodando). Ela deve valer tanto quando uma tarefa está rodando na própria sessão quanto quando a sessão do Claude deixa uma tarefa rodando em background. Já existe a frase; o pedido é melhorá-la para cobrir esses dois casos.

**Situação:** pendente.

### 7. Avisar mais rápido quando a sessão precisa de decisão do usuário
Estender ao aviso de decisão a melhoria recente de tempo de resposta feita para quando a tarefa termina na sessão (hoje cerca de 2 a 3 segundos, antes cerca de 30). Quando o terminal pede uma resposta ou decisão do usuário, como confirmar se pode confiar no diretório ou aceitar uma sugestão que está aguardando, o Jarvis hoje demora muito para avisar. Deve avisar com a mesma rapidez.

**Situação:** pendente.

### 8. Remover margem do efeito sonoro de fala e manter o som no modo direto
Remover a margem que existe no efeito sonoro tocado ao pressionar para falar. Quando o usuário configurar a fala direta nas configurações, sem definir tecla de atalho, o efeito sonoro deve ficar sempre aparente.

**Situação:** pendente.
