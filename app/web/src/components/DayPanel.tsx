import { useCallback, useEffect, useState } from 'react';
import { geoProblem, requestPosition } from '../geo.ts';
import type { Api } from '../api.ts';
import type { DayInfo } from '../types.ts';
interface Props {
  api: Api;
  /** Estado da voz e tempos da ultima resposta. */
  voiceStatus?: string;
}

function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Coluna esquerda no modo 3D: hora, data, clima e notícias. */
export function DayPanel({ api, voiceStatus }: Props) {
  const now = useNow(1000);
  const [day, setDay] = useState<DayInfo | null>(null);
  // undefined: ainda perguntando ao navegador; null: sem localizacao.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null | undefined>(undefined);

  const [geoError, setGeoError] = useState<string | null>(null);

  const locate = useCallback(async () => {
    const problem = geoProblem({ secure: window.isSecureContext, supported: !!navigator.geolocation });
    if (problem) {
      setGeoError(problem);
      return setCoords(null);
    }
    const r = await requestPosition();
    if ('errorCode' in r) {
      setGeoError(geoProblem({ secure: true, supported: true, errorCode: r.errorCode }));
      setCoords((c) => (c === undefined ? null : c));
    } else {
      setGeoError(null);
      setCoords(r);
    }
  }, []);

  useEffect(() => {
    void locate();
  }, [locate]);

  useEffect(() => {
    if (coords === undefined) return;
    let current = true;
    const load = () =>
      api.day(coords ?? undefined).then(
        (d) => current && setDay(d),
        () => {},
      );
    load();
    const id = setInterval(load, 15 * 60e3);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [api, coords]);

  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const w = day?.weather;

  return (
    <aside className="day">
      <div className="brand">llm-agent</div>
      <div className="clock">
        <div className="time">
          {time}
          <span className="seconds">{seconds}</span>
        </div>
        <div className="date">{date}</div>
      </div>
      <section className="weather">
        {w ? (
          <>
            <div className="temp">{w.temperature}°</div>
            <div>
              <div className="desc">{w.description}</div>
              <div className="muted">
                máx {w.max}° · mín {w.min}°{w.place && ` · ${w.place}`}
              </div>
            </div>
          </>
        ) : (
          <div className="muted">
            <p>{geoError ?? day?.weatherError ?? 'Carregando o clima…'}</p>
            {coords === null && (
              <button className="geo" onClick={() => void locate()}>
                Usar minha localização
              </button>
            )}
          </div>
        )}
      </section>
      <section className="news">
        <h2>Notícias do dia</h2>
        {day?.news.length ? (
          <ul>
            {day.news.map((n, i) => (
              <li key={`${i}:${n.title}`}>
                {n.link ? (
                  <a href={n.link} target="_blank" rel="noopener noreferrer">
                    {n.title}
                  </a>
                ) : (
                  <span>{n.title}</span>
                )}
                {n.source && <small>{n.source}</small>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{day?.newsError ?? 'Carregando…'}</p>
        )}
      </section>
      {voiceStatus && <div className="voice-status day-voice">{voiceStatus}</div>}
      <div className="hint">Ctrl+K busca · Esc volta · Ctrl+Tab alterna terminais · ⚙ configurações</div>
    </aside>
  );
}
