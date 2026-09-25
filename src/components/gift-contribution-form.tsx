'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
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

type PaymentResult = {
  payment_status: 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired';
  payment: null | {
    status: 'creating' | 'waiting' | 'confirmed' | 'expired' | 'failed' | 'cancelled';
    qr_code: string | null;
    qr_code_base64: string | null;
    ticket_url: string | null;
    expires_at: string;
  };
};

export function GiftContributionForm({ gift }: { gift: Gift }) {
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [vestName, setVestName] = useState('');
  const [regional, setRegional] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [payment, setPayment] = useState<PaymentResult | null>(null);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const isInsane = gift.gift_type === 'insanos';

  useEffect(() => {
    if (!payment || payment.payment_status !== 'pending' || !idempotencyKey.current) return;
    let active = true;
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/gift-contributions/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotency_key: idempotencyKey.current }),
        });
        const result = await response.json().catch(() => null) as PaymentResult | null;
        if (active && response.ok && result) setPayment(result);
      } catch {
        // Webhook remains authoritative; a temporary polling failure is retried.
      }
    };
    const timer = window.setInterval(poll, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [payment]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || payment) return;
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
          contributor_email: email,
          message,
          ...(isInsane ? { vest_name: vestName, regional_division: regional } : {}),
        }),
      });
      const result = await response.json().catch(() => null) as (PaymentResult & { message?: unknown }) | null;
      if (!response.ok) throw new Error(typeof result?.message === 'string' ? result.message : 'Não foi possível registrar a contribuição agora.');
      if (result?.payment_status === 'expired') {
        throw new Error('Esta tentativa expirou. Feche este formulário e inicie uma nova contribuição.');
      }
      if (result?.payment_status !== 'pending' && result?.payment_status !== 'confirmed') {
        throw new Error('Esta tentativa não está mais ativa. Feche este formulário e inicie uma nova contribuição.');
      }
      setPayment(result);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Não foi possível registrar a contribuição agora.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (payment) {
    if (payment.payment_status === 'confirmed') {
      return <div className={styles.success} role="status">
        <strong>Pagamento confirmado.</strong><br />Muito obrigado por fazer parte desta caminhada.
      </div>;
    }
    if (payment.payment_status !== 'pending') {
      return <div className={styles.error} role="status">
        Esta cobrança não está mais ativa. Feche esta janela e inicie uma nova contribuição.
      </div>;
    }
    const pix = payment.payment;
    const image = pix?.qr_code_base64
      ? (pix.qr_code_base64.startsWith('data:') ? pix.qr_code_base64 : `data:image/png;base64,${pix.qr_code_base64}`)
      : null;
    return <section className={styles.payment} aria-live="polite">
      <p className={styles.paymentEyebrow}>Pagamento via Pix</p>
      {image && <Image className={styles.qrCode} src={image} width={250} height={250} unoptimized
        alt="QR Code Pix desta contribuição" />}
      {pix?.qr_code ? <>
        <label className={styles.pixLabel}>Pix Copia e Cola
          <textarea className={styles.pixCode} value={pix.qr_code} readOnly rows={3} />
        </label>
        <button className={styles.copy} type="button" onClick={async () => {
          await navigator.clipboard.writeText(pix.qr_code!);
          setCopied(true);
        }}>{copied ? 'COPIADO' : 'COPIAR CÓDIGO PIX'}</button>
      </> : <p className={styles.waiting}>Preparando o seu QR Code…</p>}
      {pix?.ticket_url && <a className={styles.ticket} href={pix.ticket_url} target="_blank" rel="noreferrer">ABRIR INSTRUÇÕES DO PIX</a>}
      <p className={styles.waiting} role="status"><span aria-hidden="true" />Aguardando pagamento…</p>
      {pix?.expires_at && <p className={styles.expiration}>Este Pix expira em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(pix.expires_at))}.</p>}
    </section>;
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
          return <button type="button" key={suggestion}
            className={`${styles.quickValue} ${amount === value ? styles.quickValueActive : ''}`}
            onClick={() => setAmount(value)}>
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
    <label className={styles.field}>E-mail *
      <input name="contributor_email" value={email} onChange={event => setEmail(event.target.value)}
        inputMode="email" type="email" autoComplete="email" maxLength={254} required />
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
