'use client';
import { useState, type FormEvent } from 'react';
import styles from './admin.module.css';

async function submitSession(body: object) {
  const response = await fetch('/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.message || 'Não foi possível continuar. Tente novamente.');
  }
}
export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      await submitSession({ action: 'login', email: form.get('email'), password: form.get('password') });
      window.location.replace('/admin');
    } catch (error) { setError(error instanceof Error ? error.message : 'Tente novamente.'); setPending(false); }
  }
  return <form className={styles.form} onSubmit={login}>
    <label>E-mail<input name="email" type="email" autoComplete="username" maxLength={254} required disabled={pending} /></label>
    <label>Senha<input name="password" type="password" autoComplete="current-password" maxLength={1024} required disabled={pending} /></label>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button className={styles.button} disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
  </form>;
}
export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    setPending(true); setError('');
    try { await submitSession({ action: 'logout' }); window.location.replace('/admin/login'); }
    catch { setError('Não foi possível sair. Tente novamente.'); setPending(false); }
  }
  return <div><button className={styles.button} disabled={pending} onClick={logout}>{pending ? 'Saindo…' : 'Sair'}</button>{error && <p role="alert">{error}</p>}</div>;
}
