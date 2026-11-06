// Comandos de voz do Jarvis (etapa 3b). Cada um corresponde a uma ferramenta
// do cerebro (voice/tools.ts). A interface mostra esta mesma lista, entao ela
// nunca fica desatualizada. Arquivo sem dependencias: a UI tambem o importa.

export interface VoiceCommand {
  /** Nome da ferramenta. */
  name: string;
  title: string;
  examples: string[];
}

export const COMMANDS: VoiceCommand[] = [
  { name: 'abrir_area', title: 'Ir para uma área', examples: ['mostra minhas skills', 'abre as sessões abertas', 'o que você sabe sobre mim', 'volta para o início'] },
  { name: 'abrir_projeto', title: 'Abrir um projeto', examples: ['abre o projeto meu-app'] },
  { name: 'abrir_conversas', title: 'Ver as conversas de um projeto', examples: ['mostra as conversas do meu-app'] },
  { name: 'voltar', title: 'Voltar um nível', examples: ['volta'] },
  { name: 'estado_do_projeto', title: 'Estado de um projeto', examples: ['qual o estado do meu-app?', 'o que mudou no meu-app?'] },
  { name: 'iniciar_sessao', title: 'Trabalhar num projeto em background e ser avisado ao terminar', examples: ['abre um Claude no meu-app para corrigir os testes', 'abre um shell no meu-app'] },
  { name: 'sessoes_abertas', title: 'Listar as sessões abertas', examples: ['quais sessões estão abertas?', 'o que cada sessão está fazendo?'] },
  { name: 'estado_da_sessao', title: 'Acompanhar uma sessão', examples: ['como está a sessão do meu-app?', 'como está a sessão dois?', 'e a do codex?'] },
  { name: 'enviar_para_sessao', title: 'Mandar um recado para uma sessão', examples: ['manda pro Claude do meu-app: roda os testes', 'manda pra sessão três: pode commitar'] },
  { name: 'falar_direto_com_sessao', title: 'Falar direto com uma sessão', examples: ['quero falar direto com o Claude do meu-app', 'Jarvis, volta (para sair)'] },
  { name: 'acompanhar_sessao', title: 'Avisar quando outra sessão terminar ou der erro', examples: ['me avisa quando o Claude do meu-app terminar', 'acompanha a sessão dois'] },
  { name: 'parar_de_acompanhar', title: 'Parar de acompanhar uma sessão', examples: ['não precisa mais avisar da sessão dois'] },
  { name: 'fechar_sessao', title: 'Fechar um terminal', examples: ['fecha o terminal do meu-app'] },
  { name: 'encerrar_conversa', title: 'Encerrar a conversa', examples: ['obrigado, Jarvis, tchau', 'por hoje é só'] },
  { name: 'criar_skill', title: 'Criar uma skill', examples: ['cria uma skill nova'] },
  { name: 'registrar_sobre_mim', title: 'Registrar algo sobre você', examples: ['anota uma coisa sobre mim'] },
  { name: 'lembrar', title: 'Guardar algo na memória', examples: ['lembra que eu prefiro respostas curtas', 'anota que o meu-app entra em produção sexta'] },
  { name: 'o_que_voce_lembra', title: 'Ver o que o Jarvis lembra', examples: ['o que você lembra sobre mim?', 'o que você sabe do meu-app?'] },
  { name: 'esquecer', title: 'Apagar algo da memória', examples: ['esquece que eu tomo café sem açúcar'] },
  { name: 'criar_projeto', title: 'Criar um projeto', examples: ['cria um projeto chamado site-novo'] },
  { name: 'clima_agora', title: 'Clima de agora', examples: ['qual a temperatura agora?', 'vai chover hoje?'] },
  { name: 'noticias_do_dia', title: 'Notícias do dia', examples: ['quais as notícias de hoje?', 'tem mais alguma notícia?'] },
  { name: 'pesquisar_na_web', title: 'Pesquisar na web', examples: ['pesquisa o que é computação quântica', 'procura na internet quem ganhou o jogo ontem'] },
  { name: 'rascunhar_evolucao', title: 'Criar uma funcionalidade nova para o Jarvis', examples: ['vamos criar uma funcionalidade nova para você', 'quero que você aprenda a me dar a previsão da semana'] },
  { name: 'resumir_evolucao', title: 'Aprovar a definição da funcionalidade', examples: ['está tudo certo, pode resumir'] },
  { name: 'iniciar_evolucao', title: 'Começar o desenvolvimento', examples: ['pode começar'] },
  { name: 'status_evolucao', title: 'Acompanhar a funcionalidade nova', examples: ['como está a funcionalidade nova?'] },
  { name: 'aplicar_evolucao', title: 'Aplicar a funcionalidade nova', examples: ['pode aplicar'] },
  { name: 'descartar_evolucao', title: 'Descartar a funcionalidade nova', examples: ['descarta a funcionalidade nova'] },
  { name: 'criar_issue', title: 'Criar uma issue do app', examples: ['cria uma issue para ter mais cores no globo', 'abre uma issue: o painel do dia não atualiza'] },
  { name: 'data_e_hora', title: 'Data e hora', examples: ['que horas são?', 'que dia é hoje?'] },
  { name: 'manual_do_app', title: 'Tirar dúvidas sobre o app', examples: ['como eu crio um projeto novo?', 'para que serve a gaveta de terminais?'] },
  { name: 'comandos', title: 'Ver os comandos de voz', examples: ['o que você sabe fazer?'] },
];
