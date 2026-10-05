'use client';
import { useState, type FormEvent } from 'react';
import styles from '../admin.module.css';

const genericMessage = 'Se o e-mail estiver apto, você receberá um link de recuperação.';

export function RecoveryRequestForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    const email = String(new FormData(event.currentTarget).get('email') || '');
    try {
      const response = await fetch('/admin/recovery/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      if (response.status === 429) throw new Error('Muitas tentativas. Aguarde dez minutos e tente novamente.');
      if (!response.ok) throw new Error('Não foi possível processar sua solicitação agora.');
      setSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Tente novamente.'); }
    finally { setPending(false); }
  }
  return sent ? <p role="status">{genericMessage}</p> : <form className={styles.form} onSubmit={submit}>
    <label>E-mail<input name="email" type="email" autoComplete="email" maxLength={254} required disabled={pending} /></label>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button className={styles.button} disabled={pending}>{pending ? 'Enviando…' : 'Enviar link'}</button>
  </form>;
}

export function RecoveryPasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    const confirmation = String(form.get('confirmation') || '');
    if (password !== confirmation) { setError('As senhas não coincidem.'); return; }
    setPending(true); setError('');
    try {
      const response = await fetch('/admin/recovery/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmation }),
      });
      if (response.status === 401) { window.location.replace('/admin/recovery/invalid'); return; }
      if (response.status === 429) throw new Error('Muitas tentativas. Aguarde dez minutos e tente novamente.');
      if (response.status === 400) throw new Error('Use de 12 a 128 caracteres, com maiúscula, minúscula, número e símbolo.');
      if (!response.ok) throw new Error('Não foi possível confirmar a alteração agora. Solicite um novo link se necessário.');
      window.location.replace('/admin/login?password=changed');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Tente novamente.'); setPending(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <label>Nova senha<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} /></label>
    <label>Confirme a nova senha<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} /></label>
    <p>Use de 12 a 128 caracteres, incluindo maiúscula, minúscula, número e símbolo.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button className={styles.button} disabled={pending}>{pending ? 'Atualizando…' : 'Atualizar senha'}</button>
  </form>;
}
