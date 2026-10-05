import { LoginForm } from '../session-controls';
import Link from 'next/link';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ session?: string; password?: string }> }) {
  const params = await searchParams;
  return <main className={styles.login}><p>Acesso restrito</p><h1>Bem-vindo ao painel</h1>
    <p>Entre com sua conta de administrador para consultar os preparativos.</p>
    {params.session === 'expired' && <p role="status" className={styles.error}>Sua sessão não está disponível ou expirou. Entre novamente.</p>}
    {params.password === 'changed' && <p role="status">Senha atualizada. Entre novamente com a nova senha.</p>}
    <LoginForm />
    <p><Link href="/admin/recovery">Esqueci minha senha</Link></p>
  </main>;
}
