# Issues

Tarefas do projeto, registradas aqui porque as issues do fork no GitHub estão desativadas.

As issues 1 a 6 foram ditadas ao Jarvis na madrugada de 04/11/2026 e a 7 na manhã do mesmo dia. Ele respondeu "anotado", mas
nada foi gravado na hora; o texto abaixo foi recuperado do histórico das conversas, e a issue 7 foi redefinida depois pelo
usuário. A situação foi conferida pelo código e pelos commits da `main` em 04/11/2026, sem abrir a interface.

## Pendentes

### 1. Estética das gavetas e da trilha de navegação
A gaveta de configurações, a gaveta do painel do dia e a trilha de navegação do topo (início, projetos e caminho atual) estão
simples demais e não combinam com o visual do projeto.

- Visual de vidro discreto: transparente e sem borda.
- Trilha com setas que mostram onde você está e para onde pode voltar.
- O texto precisa continuar legível sobre o fundo do globo.

**Situação:** a conferir na interface.

### 2. Mais cores para o Jarvis
Oferecer mais opções além de dourado, ciano e branco, como vermelho, verde e roxo.

**Situação:** pendente; o código só traz as três cores atuais.

### 3. Nome e voz do assistente
- Definir outro nome para o assistente nas configurações, com a palavra de ativação acompanhando o nome novo.
- Mais opções de voz para selecionar, com prévia.

**Situação:** pendente; nenhum sinal no código da interface.

### 4. Aviso de confiança na pasta do projeto
O aviso para confiar na pasta aparece de novo nas sessões abertas pelo Jarvis. Investigar por que a confiança não fica salva
e como pular essa etapa.

**Situação:** pendente; nada no código trata disso.

### 5. Novas estéticas para o globo
Criar pelo menos mais dois estilos para o globo, trocáveis direto nas configurações. Falta conferir se o código está
organizado para aceitar estilos diferentes.

**Situação:** pendente; nenhum sinal no código da interface.

### 7. Frase das tarefas em background
Enquanto uma tarefa roda em background, nada na tela mostra que ela está rodando.

- Uma frase dinâmica no canto inferior direito: "X tarefas rodando em background...", em que X é o número de tarefas.
- Com o terminal aberto, a frase fica acima dele.
- Sem nada rodando em background, a frase não aparece.

**Situação:** pendente; nenhum sinal no código da interface.

## Concluídas

### 6. Rolagem no terminal
O layout do terminal não se adaptava à responsividade da página e gerava rolagem horizontal e vertical. A meta era eliminar
a rolagem e melhorar a estética da barra de abas.

**Situação:** concluída na `main` (merges `ce51887` e `c587073`).

### Atalho para falar com o Jarvis
Segurar um atalho para falar e soltar para ele responder, com uma onda sonora no topo da tela. Começou como Ctrl+Espaço e
hoje aceita outras teclas e o botão do meio do mouse.

**Situação:** concluída na `main` (merge `55d23a6`).
