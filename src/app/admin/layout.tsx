import type { Metadata } from 'next';
import { WeddingLogo } from '@/components/wedding-logo';
import styles from './admin.module.css';

export const metadata: Metadata = { title: 'Administração | Paula & Erik', robots: { index: false, follow: false } };
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.shell}>
    <header className={styles.header}><div className={styles.brand}><WeddingLogo size="navbar" /><span>PAINEL ADMINISTRATIVO</span></div></header>
    {children}
  </div>;
}
