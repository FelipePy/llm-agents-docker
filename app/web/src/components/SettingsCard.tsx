import { useId, useState, type ReactNode } from 'react';
import { Chevron } from './Chevron.tsx';

/** Bloco das configuracoes que recolhe pelo titulo. Comeca recolhido: o painel e desmontado ao fechar o modal, e nada fica guardado. */
export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="settings-card">
      <h3 className="settings-card-title">
        <button className="settings-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <Chevron direction={open ? 'down' : 'right'} />
          {title}
        </button>
      </h3>
      {/* Recolher so esconde: desmontar perderia o que esta sendo digitado ou gravado. */}
      <div id={bodyId} className="settings-card-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
