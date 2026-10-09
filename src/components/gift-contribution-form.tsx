'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { formatGoalAmount } from '@/lib/gifts/format';
import type { Gift } from '@/lib/gifts/types';
import type { CreditCardInput } from '@/lib/payments/contracts';
import { cardCheckoutAmount, parseCardCheckoutResult, recalledCardOperation, rememberCardOperation, forgetCardOperation,
  type CheckoutResult, type CardContributionDetails } from '@/lib/payments/card-checkout';
import { CardPaymentBrick } from './card-payment-brick';
import { CardPaymentChallenge } from './card-payment-challenge';
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

type PaymentResult = CheckoutResult;

export function GiftContributionForm({ gift, cardCheckoutEnabled=false }: { gift: Gift; cardCheckoutEnabled?: boolean }) {
  const router = useRouter();
  const previous = cardCheckoutEnabled ? recalledCardOperation(gift.id) : undefined;
  const [method, setMethod] = useState<'pix' | 'credit_card'>(previous ? 'credit_card' : 'pix');
  const [cardAmount, setCardAmount] = useState<number | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [methodLocked, setMethodLocked] = useState(Boolean(previous));
  const [amount, setAmount] = useState(previous?.details?.amount ?? '');
  const [name, setName] = useState(previous?.details?.contributor_name ?? '');
  const [phone, setPhone] = useState(previous?.details?.contributor_phone ?? '');
  const [email, setEmail] = useState(previous?.details?.contributor_email ?? '');
  const [message, setMessage] = useState(previous?.details?.message ?? '');
  const [vestName, setVestName] = useState(previous?.details?.vest_name ?? '');
  const [regional, setRegional] = useState(previous?.details?.regional_division ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [payment, setPayment] = useState<PaymentResult | null>(previous?.result ?? null);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);
  const refreshedAfterConfirmation = useRef(false);
  const idempotencyKey = useRef<string | null>(previous?.key ?? null);
  const cardDetails = useRef<CardContributionDetails | null>(previous?.details ?? null);
  const mounted = useRef(true);
  const statusInFlight = useRef(false);
  const cardSubmissionStarted = useRef(Boolean(previous));
  const isInsane = gift.gift_type === 'insanos';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const checkCardStatus = useCallback(async () => {
    if (!idempotencyKey.current || statusInFlight.current) return;
    const key = idempotencyKey.current;
    statusInFlight.current = true;
    try {
      const response = await fetch('/api/gift-contributions/status', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: key }) });
      const raw: unknown = await response.json();
      if (!response.ok) {
        if (mounted.current && idempotencyKey.current === key) {
          setRetryAllowed(response.status === 404 && !!cardDetails.current);
          setError(response.status === 404 ? 'Esta operação ainda não foi localizada. Um novo envio usará a mesma tentativa.' : 'Não foi possível consultar o pagamento. Tente consultar novamente.');
        }
        return;
      }
      const result = parseCardCheckoutResult(raw);
      if (recalledCardOperation(gift.id)?.key === key) rememberCardOperation(gift.id, key, result);
      if (mounted.current && idempotencyKey.current === key) { setPayment(result); setError(''); setRetryAllowed(false); }
    } catch { if (mounted.current && idempotencyKey.current === key) setError('Não foi possível consultar o pagamento. Tente consultar novamente.'); }
    finally { statusInFlight.current = false; }
  }, [gift.id]);

  useEffect(() => {
    if (payment?.payment_status !== 'confirmed' || refreshedAfterConfirmation.current) return;
    refreshedAfterConfirmation.current = true;
    router.refresh();
  }, [payment?.payment_status, router]);

  useEffect(() => {
    if (!payment || payment.payment_status !== 'pending' || !idempotencyKey.current) return;
    let active = true;
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      if (method === 'credit_card') { await checkCardStatus(); return; }
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
  }, [payment, method, checkCardStatus]);

  function contributionDetails(): CardContributionDetails {
    return { gift_id: gift.id, ...(gift.funding_mode === 'fixed' ? {} : { amount }),
      contributor_name: name, contributor_phone: phone, contributor_email: email, message,
      ...(isInsane ? { vest_name: vestName, regional_division: regional } : {}) };
  }

  async function submitCard(card: CreditCardInput) {
    if (inFlight.current || payment || cardSubmissionStarted.current) return;
    cardSubmissionStarted.current = true;
    inFlight.current = true;
    setSubmitting(true); setMethodLocked(true); setError('');
    idempotencyKey.current ??= crypto.randomUUID();
    const key = idempotencyKey.current;
    const details = cardDetails.current!;
    const investigating: CheckoutResult = { payment_status: 'pending', payment: {
      status: 'investigating', qr_code: null, qr_code_base64: null, ticket_url: null, expires_at: '' } };
    // Save no card data. A close/reopen after sending resumes status, never POST.
    rememberCardOperation(gift.id, key, investigating, true, details);
    try {
      const response = await fetch('/api/gift-contributions', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...details, idempotency_key: key, payment_method: 'credit_card',
          card_token: card.card_token, payment_method_id: card.payment_method_id, installments: card.installments,
          ...(card.payer ? { payer: card.payer } : {}), ...(card.device_id ? { device_id: card.device_id } : {}) }),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error('card_submission_unavailable');
      const result = parseCardCheckoutResult(raw);
      if (recalledCardOperation(gift.id)?.key === key) rememberCardOperation(gift.id, key, result, false, details);
      if (mounted.current) setPayment(result);
    } catch {
      if (mounted.current) {
        setPayment(investigating);
        setError('A comunicação foi interrompida. Vamos verificar esta tentativa antes de qualquer novo envio.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || payment) return;
    if (method === 'credit_card') {
      if (!cardCheckoutEnabled) return;
      try {
        const details = contributionDetails();
        if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
            phone.replace(/\D/g, '').length < 10 || (isInsane && !vestName.trim())) throw new Error('invalid_details');
        const total = cardCheckoutAmount(gift.funding_mode === 'fixed' ? gift.target_amount : amount);
        cardDetails.current = details;
        setError(''); setCardAmount(total);
      } catch { setError('Confira o valor, seu nome, WhatsApp e e-mail antes de continuar.'); }
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setMethodLocked(true);
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
        <strong>{method === 'credit_card' ? 'Pagamento aprovado e confirmado.' : 'Pagamento confirmado.'}</strong><br />Muito obrigado por fazer parte desta caminhada.
      </div>;
    }
    if (method === 'credit_card') {
      const messages = {
        failed: 'O pagamento foi recusado. Uma nova tentativa precisa de uma nova tokenização do cartão.',
        cancelled: 'O pagamento foi cancelado.',
        expired: 'Esta tentativa de pagamento expirou.',
      };
      const terminal = payment.payment_status !== 'pending';
      return <section className={styles.payment} aria-live="polite">
        <p className={styles.paymentEyebrow}>Pagamento com cartão</p>
        <p role="status" className={terminal ? styles.error : styles.waiting}>
          {terminal ? messages[payment.payment_status as keyof typeof messages]
            : payment.payment?.status === 'investigating' ? 'Estamos verificando esta tentativa. Não inicie outro pagamento.'
              : payment.payment?.status === 'action_required' ? 'O banco solicitou uma verificação antes de concluir o pagamento.'
              : 'Pagamento pendente. Aguardando a análise e confirmação do provedor.'}
        </p>
        {!terminal && payment.payment?.challenge?.url && <CardPaymentChallenge url={payment.payment.challenge.url} onCheck={checkCardStatus} />}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!terminal && <button className={styles.copy} type="button" onClick={() => void checkCardStatus()}>CONSULTAR PAGAMENTO</button>}
        {retryAllowed && <button className={styles.copy} type="button" onClick={() => {
          cardSubmissionStarted.current = false;
          setPayment(null); setError(''); setRetryAllowed(false);
          setCardAmount(cardCheckoutAmount(gift.funding_mode === 'fixed' ? gift.target_amount : cardDetails.current?.amount));
        }}>TENTAR ENVIO COM A MESMA CHAVE</button>}
        {terminal && <button className={styles.copy} type="button" onClick={() => {
          cardSubmissionStarted.current = false;
          forgetCardOperation(gift.id); idempotencyKey.current = null; cardDetails.current = null;
          setPayment(null); setCardAmount(null); setError(''); setRetryAllowed(false); setMethodLocked(false);
        }}>INICIAR NOVA TENTATIVA</button>}
      </section>;
    }
    if (payment.payment_status !== 'pending') {
      return <div className={styles.error} role="status">
        Esta cobrança não está mais ativa. Feche esta janela e inicie uma nova contribuição.
      </div>;
    }
    const pix = payment.payment;
    if (pix?.status === 'investigating') {
      return <div className={styles.waiting} role="status">
        Estamos verificando esta tentativa de pagamento. Não inicie outro Pix para esta contribuição.
      </div>;
    }
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

  if (method === 'credit_card' && cardAmount !== null) {
    return <div className={styles.form}>
      <div className={styles.summary}><strong>Contribuição: {formatGoalAmount(cardAmount)}</strong></div>
      <p className={styles.cardNote}>Pagamento de homologação. Os dados do cartão são preenchidos no formulário seguro do Mercado Pago.</p>
      {submitting && <p className={styles.waiting} role="status">Processando o pagamento…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <CardPaymentBrick amount={cardAmount} email={email} onSubmit={submitCard} />
      <button className={styles.copy} type="button" disabled={submitting || methodLocked} onClick={() => {
        if (idempotencyKey.current) return;
        setCardAmount(null); setMethod('pix');
      }}>VOLTAR AO PIX</button>
    </div>;
  }

  return <form className={styles.form} onSubmit={submit} noValidate>
    {cardCheckoutEnabled && <fieldset className={styles.paymentMethods}>
      <legend>Forma de pagamento</legend>
      <button type="button" className={method === 'pix' ? styles.methodActive : styles.method}
        disabled={submitting || methodLocked} aria-pressed={method === 'pix'} onClick={() => setMethod('pix')}>Pix</button>
      <button type="button" className={method === 'credit_card' ? styles.methodActive : styles.method}
        disabled={submitting || methodLocked} aria-pressed={method === 'credit_card'} onClick={() => setMethod('credit_card')}>Cartão de crédito</button>
    </fieldset>}
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
