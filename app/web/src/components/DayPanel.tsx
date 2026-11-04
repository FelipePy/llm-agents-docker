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

/**
 * O que vem de uma atualizacao do painel: desligadas as noticias automaticas, so o clima muda
 * e as manchetes da tela ficam. Sem manchete na tela (abertura, falha), a lista ainda carrega.
 */
export function nextDay(prev: DayInfo | null, next: DayInfo, autoNews: boolean): DayInfo {
  if (autoNews || !prev?.news.length) return next;
  return { ...next, news: prev.news, newsError: prev.newsError };
}

/** Liga e desliga as noticias automaticas; sem `enabled`, a escolha ainda esta carregando. */
export function AutoNewsButton({ enabled, onToggle }: { enabled: boolean | undefined; onToggle: () => void }) {
  return (
    <button className="news-auto" disabled={enabled === undefined} onClick={onToggle}>
      {enabled === false ? 'Ativar automáticas' : 'Desativar automáticas'}
    </button>
  );
}

/** Modal de notícias no modo 3D: hora, data, clima e notícias. */
export function DayPanel({ api, voiceStatus }: Props) {
  const now = useNow(1000);
  const [day, setDay] = useState<DayInfo | null>(null);
  // undefined: ainda perguntando ao navegador; null: sem localizacao.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null | undefined>(undefined);

  const [geoError, setGeoError] = useState<string | null>(null);
  // undefined: ainda perguntando ao servidor.
  const [autoNews, setAutoNews] = useState<boolean | undefined>(undefined);
  const [autoNewsError, setAutoNewsError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    // Sem resposta (servidor antigo?), vale o padrao: ligadas.
    api.autoNews().then(
      (on) => current && setAutoNews(on),
      () => current && setAutoNews(true),
    );
    return () => {
      current = false;
    };
  }, [api]);

  const toggleAutoNews = async () => {
    if (autoNews === undefined) return;
    try {
      setAutoNews(await api.saveAutoNews(!autoNews));
      setAutoNewsError(null);
    } catch {
      setAutoNewsError('Não consegui salvar a escolha; tente de novo.');
    }
  };

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
    if (coords === undefined || autoNews === undefined) return;
    let current = true;
    const load = () =>
      api.day(coords ?? undefined).then(
        (d) => current && setDay((prev) => nextDay(prev, d, autoNews)),
        () => {},
      );
    load();
    const id = setInterval(load, 15 * 60e3);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [api, coords, autoNews]);

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
        <div className="news-head">
          <h2>Notícias do dia</h2>
          <AutoNewsButton enabled={autoNews} onToggle={() => void toggleAutoNews()} />
        </div>
        {autoNews === false && <p className="muted news-off">Automáticas desativadas: a lista não muda sozinha e o Jarvis não as anuncia. Por voz, é só pedir.</p>}
        {autoNewsError && <p className="muted news-off">{autoNewsError}</p>}
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
