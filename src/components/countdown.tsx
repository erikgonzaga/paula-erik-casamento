'use client';
import { useEffect, useState } from 'react';
export const weddingTime = new Date('2026-11-21T13:00:00-03:00').getTime();
export function Countdown() {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => { const update = () => setRemaining(Math.max(0, weddingTime - Date.now())); update(); const interval = setInterval(update, 1000); return () => clearInterval(interval); }, []);
  if (remaining === 0) return <p className="celebration">Chegou o dia de dar mais um passo juntos.</p>;
  const seconds = remaining === null ? null : Math.floor(remaining / 1000);
  const values = seconds === null ? ['—', '—', '—', '—'] : [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0'));
  return <div className="countdown" role="group" aria-label="Contagem regressiva para a recepção, em 21 de novembro de 2026 às 13 horas, horário de Brasília">{['dias', 'horas', 'minutos', 'segundos'].map((label, i) => <div key={label}><span className="count-value">{values[i]}</span><span className="count-label">{label}</span></div>)}</div>;
}
