import styles from './admin.module.css';
export default function Loading() { return <main aria-busy="true"><h1>Visão geral</h1><p role="status" className={styles.note}>Verificando acesso e carregando informações…</p></main>; }
