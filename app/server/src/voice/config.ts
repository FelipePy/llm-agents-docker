// Opcoes das configuracoes que o Jarvis muda por voz (ferramenta mudar_configuracao).
// As da interface ficam no navegador (localStorage) e vao como comando de UI; as do servidor
// (transcricao, noticias automaticas) sao gravadas aqui mesmo. Arquivo sem dependencias: a UI
// tambem o importa. Atalhos e pausas ficam de fora (combinacoes de teclas e tempos nao se falam bem).

/** Opcoes guardadas na interface (aplicadas pelo comando de UI "setting"). */
export type UiSettingKey = 'legendas' | 'legendaUsuario' | 'legendaJarvis' | 'escuta' | 'atalho' | 'modo3d' | 'reduzirMovimento' | 'demonstracao' | 'sons' | 'cor' | 'estilo';
/** Opcoes guardadas no servidor. */
export type ServerSettingKey = 'agenteVoz' | 'modeloVoz' | 'transcricao' | 'modeloTranscricao' | 'noticiasAutomaticas';

export interface ConfigChoice {
  id: string;
  label: string;
  /** Outros jeitos de falar a escolha. */
  names?: string[];
}

export interface ConfigOption {
  key: UiSettingKey | ServerSettingKey;
  where: 'ui' | 'server';
  /** Nome falado ao usuario ("as legendas"). */
  label: string;
  /** Jeitos de falar a opcao (o rotulo da tela entra aqui tambem). */
  names: string[];
  /** Ligar/desligar ou uma escolha entre `choices`. */
  choices?: ConfigChoice[];
  /** As escolhas vem do servidor na hora (os modelos do plano). */
  dynamic?: boolean;
  /** Pede confirmacao antes de mudar (muda quem ouve ou transcreve a voz). */
  sensitive?: boolean;
}

export const CONFIG_OPTIONS: ConfigOption[] = [
  // "As legendas" mexe nas duas; cada uma tambem tem o seu nome.
  { key: 'legendas', where: 'ui', label: 'as legendas', names: ['legendas', 'legenda', 'as duas legendas', 'texto da conversa'] },
  { key: 'legendaUsuario', where: 'ui', label: 'a legenda da sua fala', names: ['legenda da minha fala', 'minha legenda', 'legenda do usuário', 'legenda do que eu falo', 'legenda da sua fala'] },
  { key: 'legendaJarvis', where: 'ui', label: 'a legenda da fala do Jarvis', names: ['legenda do jarvis', 'legenda da fala do jarvis', 'sua legenda', 'legenda da sua resposta', 'legenda do que você fala'] },
  {
    key: 'agenteVoz',
    where: 'server',
    label: 'o agente que responde por voz',
    names: ['agente que responde', 'agente da voz', 'agente', 'provedor', 'cérebro', 'quem responde'],
    choices: [
      { id: 'claude', label: 'Claude', names: ['anthropic'] },
      { id: 'codex', label: 'Codex', names: ['openai', 'gpt', 'chatgpt'] },
    ],
    sensitive: true,
  },
  { key: 'modeloVoz', where: 'server', label: 'o modelo que responde por voz', names: ['modelo que responde', 'modelo da voz', 'modelo', 'modelo do jarvis', 'modelo do cérebro'], dynamic: true, sensitive: true },
  { key: 'escuta', where: 'ui', label: 'a escuta ativa', names: ['escuta ativa', 'escuta', 'microfone', 'ouvir', 'palavra de ativação'], sensitive: true },
  { key: 'atalho', where: 'ui', label: 'o atalho de falar', names: ['atalho de falar', 'falar com o atalho', 'segurar para falar', 'atalho'], sensitive: true },
  { key: 'modo3d', where: 'ui', label: 'o modo 3D', names: ['modo 3d', '3d', 'tres d', 'globo 3d'] },
  { key: 'reduzirMovimento', where: 'ui', label: 'reduzir movimento', names: ['reduzir movimento', 'movimento reduzido', 'animações', 'menos movimento'] },
  { key: 'demonstracao', where: 'ui', label: 'a demonstração de voz', names: ['demonstração de voz', 'demonstração', 'simulação de voz'] },
  { key: 'sons', where: 'ui', label: 'os sons de clique', names: ['sons de clique', 'sons', 'som de clique', 'barulho de clique'] },
  {
    key: 'cor',
    where: 'ui',
    label: 'a cor do Jarvis',
    names: ['cor do jarvis', 'cor', 'cor do globo', 'cor da interface'],
    // Os mesmos ids de GLOBE_COLORS (app/web/src/scene/globe.ts; o teste da interface confere).
    choices: [
      { id: 'dourado', label: 'dourado', names: ['dourada', 'ouro', 'amarelo', 'laranja'] },
      { id: 'ciano', label: 'ciano', names: ['azul', 'azul claro'] },
      { id: 'branco', label: 'branco', names: ['branca', 'cinza'] },
      { id: 'vermelho', label: 'vermelho', names: ['vermelha'] },
      { id: 'verde', label: 'verde' },
      { id: 'roxo', label: 'roxo', names: ['roxa', 'lilás', 'violeta'] },
    ],
  },
  {
    key: 'estilo',
    where: 'ui',
    label: 'o estilo do Jarvis',
    names: ['estilo do jarvis', 'estilo', 'estilo do globo', 'desenho do globo'],
    // Os mesmos ids de GLOBE_STYLES (app/web/src/scene/globe.ts).
    choices: [
      { id: 'holografico', label: 'holográfico', names: ['holograma'] },
      { id: 'particulas', label: 'partículas', names: ['partícula'] },
      { id: 'orbitas', label: 'órbitas', names: ['órbita'] },
    ],
  },
  {
    key: 'transcricao',
    where: 'server',
    label: 'quem transcreve a sua fala',
    names: ['transcrição', 'transcrição da fala', 'reconhecimento de voz', 'quem transcreve', 'whisper'],
    choices: [
      { id: 'local', label: 'no computador', names: ['local', 'neste computador', 'offline', 'whisper local'] },
      { id: 'groq', label: 'na nuvem, pelo Groq', names: ['groq', 'nuvem', 'online', 'internet'] },
    ],
    sensitive: true,
  },
  {
    key: 'modeloTranscricao',
    where: 'server',
    label: 'o modelo de transcrição do Groq',
    names: ['modelo de transcrição', 'modelo do groq', 'modelo do whisper', 'modelo da transcrição'],
    // Os mesmos ids de GROQ_MODELS (voice/settings.ts; o teste confere).
    choices: [
      { id: 'whisper-large-v3-turbo', label: 'o turbo', names: ['turbo', 'rápido', 'large v3 turbo'] },
      { id: 'whisper-large-v3', label: 'o large v3', names: ['large v3', 'completo', 'preciso', 'mais preciso', 'v3'] },
    ],
    sensitive: true,
  },
  { key: 'noticiasAutomaticas', where: 'server', label: 'as notícias automáticas', names: ['notícias automáticas', 'notícias sozinhas', 'notícias espontâneas', 'avisos de notícias'] },
];
