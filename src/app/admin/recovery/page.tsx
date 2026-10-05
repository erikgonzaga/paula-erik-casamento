import Link from 'next/link';
import { RecoveryRequestForm } from './recovery-forms';
import styles from '../admin.module.css';

export default function RecoveryPage() {
  return <main className={styles.login}>
    <p>Acesso restrito</p><h1>Recuperar senha</h1>
    <p>Informe o e-mail da sua conta de administrador. Se ela estiver apta, enviaremos um link de recuperação.</p>
    <RecoveryRequestForm />
    <p>Abra o link recebido no mesmo navegador e perfil usados para solicitar a recuperação.</p>
    <p><Link href="/admin/login">Voltar ao login</Link></p>
  </main>;
}
