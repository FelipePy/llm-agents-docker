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
  { name: 'iniciar_sessao', title: 'Trabalhar num projeto em background', examples: ['abre um Claude no meu-app para corrigir os testes', 'abre um shell no meu-app'] },
  { name: 'sessoes_abertas', title: 'Listar as sessões abertas', examples: ['quais sessões estão abertas?'] },
  { name: 'estado_da_sessao', title: 'Acompanhar uma sessão', examples: ['como está a sessão do meu-app?'] },
  { name: 'criar_skill', title: 'Criar uma skill', examples: ['cria uma skill nova'] },
  { name: 'registrar_sobre_mim', title: 'Registrar algo sobre você', examples: ['anota uma coisa sobre mim'] },
  { name: 'criar_projeto', title: 'Criar um projeto', examples: ['cria um projeto chamado site-novo'] },
  { name: 'comandos', title: 'Ver os comandos de voz', examples: ['o que você sabe fazer?'] },
];
