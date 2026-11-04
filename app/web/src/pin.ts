// Senha da voz: so numeros, de 4 a 6 digitos (a mesma regra do servidor, voice/speaker.ts).
// Ela tambem libera o acesso falada no lugar do "Jarvis".

export const MIN_PIN = 4;
export const MAX_PIN = 6;

export type AccessMode = 'voice' | 'pin' | 'both';

export const ACCESS_OPTIONS: { value: AccessMode; label: string; hint: string }[] = [
  { value: 'both', label: 'Voz e senha', hint: 'Chame "Jarvis" ou fale a senha, quando quiser.' },
  { value: 'voice', label: 'Só a voz', hint: 'Chame "Jarvis"; a sua voz é conferida.' },
  { value: 'pin', label: 'Só a senha', hint: 'Fale a senha para abrir a conversa; o "Jarvis" sozinho não abre.' },
];

/** O que foi digitado, sem nada que nao seja digito e no maximo 6 digitos. */
export const pinInput = (value: string): string => value.replace(/\D/g, '').slice(0, MAX_PIN);

/** Problema da senha nova (para mostrar abaixo do campo), ou null. */
export function pinProblem(pin: string): string | null {
  if (!/^[0-9]*$/.test(pin)) return 'A senha aceita só números.';
  if (pin.length < MIN_PIN || pin.length > MAX_PIN) return `A senha precisa ter de ${MIN_PIN} a ${MAX_PIN} dígitos.`;
  return null;
}
