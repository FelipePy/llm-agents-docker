import { useEffect, useRef, useState } from 'react';
import { hasMouse } from '../prefs.ts';
import {
  DEFAULT_GLOBE_HOTKEY, DEFAULT_HOTKEY, HotkeyCapture, MAX_HOTKEY_KEYS, MIDDLE_BUTTON, hotkeyConflict, hotkeyHasMouse, sameHotkey, type Hotkey, type NamedHotkey,
} from '../voice/hotkey.ts';

const TALK_NAME = 'Atalho para falar';
const GLOBE_NAME = 'Atalho para trocar o estilo';

interface Props {
  name: string;
  title: string;
  hotkey: Hotkey;
  fallback: Hotkey;
  /** Os outros atalhos configuraveis: o que eles usam nao pode ser gravado aqui. */
  others: NamedHotkey[];
  onChange: (h: Hotkey) => void;
  /** Enquanto espera a combinacao, os atalhos do app nao podem reagir as teclas. */
  onCapturing: (on: boolean) => void;
}

/** Um atalho: mostra o atual, grava outro direto do teclado e do mouse e volta ao padrao. */
export function HotkeyField({ name, title, hotkey, fallback, others, onChange, onCapturing }: Props) {
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState('');
  // A combinacao recusada, para dizer por que nada mudou.
  const [refused, setRefused] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const mouse = hasMouse();
  const inUse = hotkeyConflict(hotkey, others);

  const pick = (h: Hotkey) => {
    const owner = hotkeyConflict(h, others);
    setRefused(owner ? `${h.label} já é usado em “${owner}”. Escolha outro.` : '');
    if (!owner) onChange(h);
  };

  useEffect(() => {
    if (!capturing) return;
    const stop = () => setCapturing(false);
    setPreview('');
    setRefused('');
    const capture = new HotkeyCapture(pick, stop, setPreview, mouse);
    const consume = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const down = (e: KeyboardEvent) => {
      consume(e);
      capture.keydown(e);
    };
    const up = (e: KeyboardEvent) => {
      consume(e);
      capture.keyup(e);
    };
    const mouseDown = (e: MouseEvent) => {
      if (e.button !== MIDDLE_BUTTON) return;
      consume(e);
      capture.mousedown(e);
    };
    const mouseUp = (e: MouseEvent) => {
      if (e.button !== MIDDLE_BUTTON) return;
      consume(e);
      // Depois do `auxclick`, que vem em seguida: terminar agora o deixaria passar.
      setTimeout(() => capture.mouseup(e));
    };
    const aux = (e: MouseEvent) => {
      if (e.button === MIDDLE_BUTTON) consume(e);
    };
    const outside = (e: PointerEvent) => {
      // O botao do meio e parte da gravacao em qualquer lugar da tela (e nao chega ao zoom da cena).
      if (e.button === MIDDLE_BUTTON) e.stopPropagation();
      else if (!root.current?.contains(e.target as Node)) stop();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', stop);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('mousedown', mouseDown, true);
    window.addEventListener('mouseup', mouseUp, true);
    window.addEventListener('auxclick', aux, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', stop);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('mousedown', mouseDown, true);
      window.removeEventListener('mouseup', mouseUp, true);
      window.removeEventListener('auxclick', aux, true);
      onCapturing(false);
      // Com o foco no botao, Espaco (o atalho antigo, por habito) abriria outra captura.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && root.current?.contains(focused)) focused.blur();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  return (
    <div className="field hotkey-field" ref={root} title={title}>
      <span>{name}</span>
      <div className="hotkey-row">
        <kbd className={capturing ? 'hotkey-current capturing' : 'hotkey-current'} aria-live="polite">
          {capturing ? preview || 'Aperte e segure…' : hotkey.label}
        </kbd>
        <button
          onClick={() => {
            // Junto com a tela: entre o clique e a captura, nenhum atalho pode reagir.
            if (!capturing) onCapturing(true);
            setCapturing(!capturing);
          }}
        >
          {capturing ? 'Cancelar' : 'Gravar'}
        </button>
      </div>
      {capturing && (
        <small className="hotkey-hint">
          Até {MAX_HOTKEY_KEYS} teclas{mouse ? ', contando o botão do meio do mouse (clique do scroll)' : ''}. Solte para gravar.
        </small>
      )}
      {!capturing && refused && (
        <small className="hotkey-hint hotkey-refused" role="alert">
          {refused}
        </small>
      )}
      {!capturing && inUse && <small className="hotkey-hint hotkey-refused">Também usado em “{inUse}”. Grave outro atalho.</small>}
      {!capturing && hotkeyHasMouse(hotkey) && (
        <small className="hotkey-hint">O botão do meio pode conflitar com o navegador ou o sistema. Se atrapalhar, grave outro atalho.</small>
      )}
      {!mouse && <small className="hotkey-hint">Sem mouse neste aparelho: o botão do meio fica indisponível.</small>}
      <button
        className="link"
        disabled={sameHotkey(hotkey, fallback)}
        onClick={() => {
          setCapturing(false);
          pick(fallback);
        }}
      >
        Voltar ao padrão ({fallback.label})
      </button>
    </div>
  );
}

interface PairProps {
  hotkey: Hotkey;
  globeHotkey: Hotkey;
  onChange: (h: Hotkey) => void;
  onCapturing: (on: boolean) => void;
}

/** O que se segura para falar. */
export function TalkHotkeyField({ hotkey, globeHotkey, onChange, onCapturing }: PairProps) {
  return (
    <HotkeyField
      name={TALK_NAME}
      title="O que você segura para falar com o Jarvis: uma tecla ou uma combinação de até três, que pode incluir o botão do meio do mouse"
      hotkey={hotkey}
      fallback={DEFAULT_HOTKEY}
      others={[{ name: GLOBE_NAME, hotkey: globeHotkey }]}
      onChange={onChange}
      onCapturing={onCapturing}
    />
  );
}

/** O que passa o globo para o proximo estilo. */
export function GlobeHotkeyField({ hotkey, globeHotkey, onChange, onCapturing }: PairProps) {
  return (
    <HotkeyField
      name={GLOBE_NAME}
      title="Passa o globo para o próximo estilo, sem abrir as configurações (só no Modo 3D): uma tecla ou uma combinação de até três, que pode incluir o botão do meio do mouse"
      hotkey={globeHotkey}
      fallback={DEFAULT_GLOBE_HOTKEY}
      others={[{ name: TALK_NAME, hotkey }]}
      onChange={onChange}
      onCapturing={onCapturing}
    />
  );
}
