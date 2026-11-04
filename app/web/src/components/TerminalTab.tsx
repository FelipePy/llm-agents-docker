import type { SessionInfo } from '../types.ts';
import { tabName } from '../tabs.ts';

interface Props {
  session: SessionInfo;
  projectName?: string;
  index: number;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}

export function TerminalTab({ session, projectName, index, active, onActivate, onClose }: Props) {
  const name = tabName(session, projectName);
  return (
    <div className={active ? 'tab active' : 'tab'} title={name} onClick={onActivate}>
      {index < 9 && <kbd>{index + 1}</kbd>}
      {active && <span className={`dot ${session.agent}`} />}
      <span className="tab-name">{name}</span>
      <button
        className="x"
        aria-label="Fechar"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}
