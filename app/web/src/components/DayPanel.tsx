import { useEffect, useState } from 'react';
import type { Api } from '../api.ts';
import type { DayInfo } from '../types.ts';
import { Settings, type SettingsState, type SettingsToggles } from './Settings.tsx';

interface Props {
  api: Api;
  settings: SettingsState;
  toggles: SettingsToggles;
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
export function DayPanel({ api, settings, toggles }: Props) {
  const now = useNow(1000);
  const [day, setDay] = useState<DayInfo | null>(null);
  // undefined: ainda perguntando ao navegador; null: sem localizacao.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null | undefined>(undefined);

  useEffect(() => {
    if (!navigator.geolocation) return setCoords(null);
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setCoords(null),
      { timeout: 8000, maximumAge: 3600e3 },
    );
  }, []);

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
          <p className="muted">{day?.weatherError ?? 'Carregando o clima…'}</p>
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
      <Settings settings={settings} toggles={toggles} />
      <div className="hint">Ctrl+K busca · Esc volta · Ctrl+Tab alterna terminais</div>
    </aside>
  );
}
