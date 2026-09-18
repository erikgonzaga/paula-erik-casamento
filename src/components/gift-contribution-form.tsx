'use client';

import { useRef, useState, type FormEvent } from 'react';
import { formatGoalAmount } from '@/lib/gifts/format';
import type { Gift } from '@/lib/gifts/types';
import styles from './gift-contribution-form.module.css';

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  const international = digits.startsWith('55') && digits.length > 11;
  const local = international ? digits.slice(2) : digits;
  const area = local.slice(0, 2);
  const first = local.length > 10 ? local.slice(2, 7) : local.slice(2, 6);
  const last = local.length > 10 ? local.slice(7, 11) : local.slice(6, 10);
  if (!area) return international ? '+55' : '';
  let formatted = `${international ? '+55 ' : ''}(${area}`;
  if (area.length === 2) formatted += ')';
  if (first) formatted += ` ${first}`;
  if (last) formatted += `-${last}`;
  return formatted;
}

const suggestions = [50, 100, 200];

export function GiftContributionForm({ gift }: { gift: Gift }) {
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [vestName, setVestName] = useState('');
  const [regional, setRegional] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const inFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const isInsane = gift.gift_type === 'insanos';
  const remaining = gift.funding_mode === 'goal' ? gift.progress?.remaining_amount ?? 0 : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || success) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch('/api/gift-contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey.current,
          gift_id: gift.id,
          ...(gift.funding_mode === 'fixed' ? {} : { amount }),
          contributor_name: name,
          contributor_phone: phone,
          message,
          ...(isInsane ? { vest_name: vestName, regional_division: regional } : {}),
        }),
      });
      const result = await response.json().catch(() => null) as { message?: unknown; payment_status?: unknown } | null;
      if (!response.ok) throw new Error(typeof result?.message === 'string' ? result.message : 'Não foi possível registrar a contribuição agora.');
      if (result?.payment_status === 'expired') {
        throw new Error('Esta tentativa expirou. Feche este formulário e inicie uma nova contribuição.');
      }
      if (result?.payment_status !== 'pending' && result?.payment_status !== 'confirmed') {
        throw new Error('Esta tentativa não está mais ativa. Feche este formulário e inicie uma nova contribuição.');
      }
      setSuccess(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Não foi possível registrar a contribuição agora.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (success) {
    return <p className={styles.success} role="status">Contribuição registrada. A etapa de pagamento será exibida aqui.</p>;
  }

  return <form className={styles.form} onSubmit={submit} noValidate>
    {gift.funding_mode === 'goal' && gift.progress && <div className={styles.summary}>
      <strong>Restam {formatGoalAmount(gift.progress.remaining_amount)}</strong><br />
      para completar este presente.
    </div>}
    {gift.funding_mode === 'fixed' && <div className={styles.summary}>
      <strong>Valor da contribuição: {formatGoalAmount(gift.target_amount!)}</strong>
    </div>}
    {gift.funding_mode !== 'fixed' && <>
      <div className={styles.amountLabel}>Sugestões de valor</div>
      <div className={styles.quickValues} aria-label="Sugestões de valor">
        {suggestions.map(suggestion => {
          const value = `${suggestion},00`;
          const disabled = remaining !== null && suggestion > remaining;
          return <button type="button" key={suggestion}
            className={`${styles.quickValue} ${amount === value ? styles.quickValueActive : ''}`}
            disabled={disabled} onClick={() => setAmount(value)}>
            {formatGoalAmount(suggestion)}
          </button>;
        })}
      </div>
      <label className={styles.field}>Outro valor *
        <input name="amount" value={amount} onChange={event => setAmount(event.target.value)}
          inputMode="decimal" autoComplete="off" maxLength={16} placeholder="R$ 0,00" required />
      </label>
    </>}
    <label className={styles.field}>Nome *
      <input name="contributor_name" value={name} onChange={event => setName(event.target.value)}
        autoComplete="name" maxLength={150} required />
    </label>
    <label className={styles.field}>WhatsApp *
      <input name="contributor_phone" value={phone} onChange={event => setPhone(maskPhone(event.target.value))}
        inputMode="tel" autoComplete="tel" maxLength={19} placeholder="(11) 99999-9999" required />
    </label>
    {isInsane && <>
      <label className={styles.field}>Nome de Colete *
        <input name="vest_name" value={vestName} onChange={event => setVestName(event.target.value)}
          autoComplete="off" maxLength={150} required />
      </label>
      <label className={styles.field}>Regional / Divisão <span className={styles.optional}>(opcional)</span>
        <input name="regional_division" value={regional} onChange={event => setRegional(event.target.value)}
          autoComplete="off" maxLength={150} />
      </label>
    </>}
    <label className={styles.field}>Mensagem para os noivos <span className={styles.optional}>(opcional)</span>
      <textarea name="message" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} />
    </label>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button className={styles.submit} type="submit" disabled={submitting}>
      {submitting ? 'REGISTRANDO…' : 'CONTINUAR'}
    </button>
  </form>;
}
