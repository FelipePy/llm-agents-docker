// Copia texto puro para a area de transferencia. No app desktop do Windows a API do navegador
// pode falhar (ou nem existir): ai vai pelo jeito antigo, com um campo escondido e "copy".

export async function copyText(text: string, doc: Document = document, nav: Navigator | undefined = globalThis.navigator): Promise<boolean> {
  if (!text) return false;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // tenta o jeito antigo abaixo
  }
  return legacyCopy(text, doc);
}

function legacyCopy(text: string, doc: Document): boolean {
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  doc.body.appendChild(area);
  // A selecao do usuario volta depois: o botao continua valendo para outro clique.
  const sel = doc.getSelection();
  const ranges = sel ? Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i)) : [];
  try {
    area.select();
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    if (sel) {
      sel.removeAllRanges();
      for (const r of ranges) sel.addRange(r);
    }
  }
}

/** Texto selecionado dentro de `root` (vazio se a selecao estiver fora ou vazia). */
export function selectionIn(root: Node | null, sel: Selection | null): string {
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return '';
  if (!sel.anchorNode || !sel.focusNode || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return '';
  return sel.toString().trim() ? sel.toString() : '';
}

type Key = { type: string; key: string; code?: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };

/** Ctrl+Shift+C: copiar no terminal. Pelo codigo da tecla tambem, para valer em outro layout. */
export function isCopyShortcut(e: Key): boolean {
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key.toLowerCase() === 'c' || e.code === 'KeyC');
}

/**
 * Trata o atalho de copiar antes do xterm. Devolve true se a tecla foi tratada aqui (o xterm nao
 * a processa). Ctrl+C sem Shift nao entra: continua sendo o ^C que interrompe o programa.
 * Sem selecao, Ctrl+Shift+C so e engolido, para nao abrir o inspetor do navegador.
 */
export function handleCopyKey(e: Key & { preventDefault(): void }, selection: string, copy: (text: string) => void): boolean {
  if (!isCopyShortcut(e)) return false;
  e.preventDefault();
  if (e.type === 'keydown' && selection) copy(selection);
  return true;
}
