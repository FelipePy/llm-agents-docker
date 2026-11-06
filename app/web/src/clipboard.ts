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
