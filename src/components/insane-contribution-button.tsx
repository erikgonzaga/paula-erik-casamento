'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatGiftAmount } from '@/lib/gifts/format';
import type { InsaneGift } from '@/lib/gifts/types';
import { GiftContributionForm } from './gift-contribution-form';
import styles from './gift-contribution-form.module.css';

export function InsaneContributionButton({ gift, className }: { gift: InsaneGift; className: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return <>
    <button id={`contribuir-${gift.slug.replace(/^moeda-/, '')}`} className={className}
      type="button" onClick={() => setOpen(true)}>CONTRIBUIR</button>
    {open && createPortal(
      <div className={styles.overlay} role="presentation" onMouseDown={() => setOpen(false)}>
        <section className={styles.dialog} role="dialog" aria-modal="true"
          aria-labelledby={`insane-contribution-${gift.id}`} onMouseDown={event => event.stopPropagation()}>
          <button className={styles.close} type="button" aria-label="Fechar contribuição" onClick={() => setOpen(false)}>×</button>
          <p className={styles.eyebrow}>PRESENTE INSANO</p>
          <h2 id={`insane-contribution-${gift.id}`}>{gift.name}</h2>
          <p className={styles.fixedAmount}>{formatGiftAmount(gift.target_amount)}</p>
          <GiftContributionForm gift={gift} />
        </section>
      </div>,
      document.body,
    )}
  </>;
}
