import { useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import type { Api, RemoteStatus } from '../api.ts';
import { SettingsCard } from './SettingsCard.tsx';

export interface RemoteStep {
  done: boolean;
  text: string;
}

/** Passo a passo do acesso pelo celular, marcando o que ja esta pronto. */
export function remoteSteps(s: RemoteStatus): RemoteStep[] {
  return [
    { done: s.installed, text: 'Instale o Tailscale neste PC (tailscale.com/download; no Windows, o instalador normal) e entre na sua conta.' },
    { done: s.running, text: 'Deixe o Tailscale conectado.' },
    { done: s.https, text: 'No painel do Tailscale (login.tailscale.com → DNS), ligue MagicDNS e HTTPS Certificates.' },
    { done: s.serving, text: 'Ligue o acesso aqui embaixo.' },
    { done: false, text: 'No celular, instale o Tailscale (mesma conta) e o app Jarvis, e leia o QR code.' },
  ];
}

/** QR code do link em SVG (fundo claro, para a camera ler bem). */
export const qrSvg = (link: string) => renderSVG(link, { border: 2, whiteColor: '#ffffff', blackColor: '#000000' });

type Notice = { kind: 'ok' | 'error' | 'busy'; text: string } | null;

/** Acesso pelo celular: tailscale serve desta interface e o QR code para o app Android. */
export function RemoteSettings({ api }: { api: Api }) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [showQr, setShowQr] = useState(false);

  const load = () =>
    api.remote().then(setStatus, () => setNotice({ kind: 'error', text: 'Não consegui ler o acesso pelo celular (servidor antigo? reinicie o llm-agent ui).' }));
  useEffect(() => {
    void load();
  }, [api]);

  const toggle = async (on: boolean) => {
    setNotice({ kind: 'busy', text: on ? 'Ligando…' : 'Desligando…' });
    try {
      setStatus(await api.setRemote(on));
      setNotice({ kind: 'ok', text: on ? 'Pronto: o Jarvis está acessível pela sua tailnet.' : 'Acesso pelo celular desligado.' });
      if (!on) setShowQr(false);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const busy = notice?.kind === 'busy';
  return (
    <SettingsCard title="Acesso pelo celular">
      <p className="muted">
        Use o Jarvis no Android, fora de casa, com voz e terminais. A conexão passa pelo Tailscale: só os seus aparelhos
        enxergam o PC, sem abrir porta no roteador. O PC precisa ficar ligado.
      </p>
      {status && (
        <ol className="remote-steps">
          {remoteSteps(status).map((step) => (
            <li key={step.text} className={step.done ? 'done' : ''}>
              {step.text}
            </li>
          ))}
        </ol>
      )}
      {status?.problem && <p className="stt-notice error">{status.problem}</p>}
      {status && (
        <div className="remote-actions">
          <button className="settings-button" disabled={busy || !status.running} onClick={() => void toggle(!status.serving)}>
            {status.serving ? 'Desligar acesso pelo celular' : 'Ligar acesso pelo celular'}
          </button>
          <button className="settings-button" disabled={busy} onClick={() => void load()}>
            Verificar de novo
          </button>
        </div>
      )}
      {status?.serving && status.link && (
        <>
          <p className="muted">
            Endereço: <code>https://{status.host}</code>. O QR code leva a chave de acesso do Jarvis: não mostre para outras pessoas.
          </p>
          <button className="settings-button" onClick={() => setShowQr(!showQr)}>
            {showQr ? 'Esconder QR code' : 'Mostrar QR code'}
          </button>
          {showQr && <div className="remote-qr" role="img" aria-label="QR code do Jarvis" dangerouslySetInnerHTML={{ __html: qrSvg(status.link) }} />}
        </>
      )}
      {notice && <p className={`stt-notice ${notice.kind}`}>{notice.text}</p>}
    </SettingsCard>
  );
}
