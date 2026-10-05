import Link from 'next/link';
import styles from '../../admin.module.css';

export default function InvalidRecoveryPage() {
  return <main className={styles.login}>
    <p>Acesso restrito</p><h1>Link indisponível</h1>
    <p>Este link é inválido, expirou ou já foi usado. Solicite um novo link no mesmo navegador em que pretende abri-lo.</p>
    <p><Link href="/admin/recovery">Solicitar novo link</Link></p>
    <p><Link href="/admin/login">Voltar ao login</Link></p>
  </main>;
}
