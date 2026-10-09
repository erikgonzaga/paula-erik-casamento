'use client';

import { useEffect, useRef } from 'react';
import { completedChallenge, safeChallengeUrl } from '@/lib/payments/card-checkout';
import styles from './gift-contribution-form.module.css';

export function CardPaymentChallenge({ url, onCheck }: { url: string; onCheck(): Promise<void> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const check = useRef(onCheck);
  useEffect(() => { check.current = onCheck; }, [onCheck]);
  const source = safeChallengeUrl(url, typeof window === 'undefined' ? undefined : window.location.origin);
  useEffect(() => {
    if (!source) return;
    const completed = (event: MessageEvent) => {
      if (completedChallenge(event, frame.current?.contentWindow ?? null, source)) void check.current();
    };
    window.addEventListener('message', completed);
    return () => window.removeEventListener('message', completed);
  }, [source]);
  if (!source) return <p className={styles.error}>A verificação segura não está disponível. Consulte o status novamente.</p>;
  return <div className={styles.challenge}>
    <p>Conclua a verificação solicitada pelo banco.</p>
    <iframe ref={frame} src={source} title="Verificação segura do cartão"
      sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
    <button className={styles.copy} type="button" onClick={() => void check.current()}>JÁ CONCLUÍ A VERIFICAÇÃO</button>
  </div>;
}
