import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasRecoverySession } from '@/lib/admin/recovery';
import { RecoveryPasswordForm } from '../recovery-forms';
import styles from '../../admin.module.css';

export const dynamic = 'force-dynamic';

export default async function PasswordPage() {
  let valid = false;
  try { valid = await hasRecoverySession(); } catch { /* Fail closed. */ }
  if (!valid) redirect('/admin/recovery/invalid');
  return <main className={styles.login}>
    <p>Acesso restrito</p><h1>Definir nova senha</h1>
    <p>A recuperação é temporária e de uso único. Depois da alteração, entre novamente no painel.</p>
    <RecoveryPasswordForm />
    <p><Link href="/admin/login">Voltar ao login</Link></p>
  </main>;
}
