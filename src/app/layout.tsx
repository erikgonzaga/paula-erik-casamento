import type { Metadata } from 'next';
import './globals.css';
import './rsvp.css';
export const metadata: Metadata = {
  title: 'Paula & Erik — Caminhando juntos',
  description: 'Uma caminhada que começou em uma trilha. Paula e Erik, 21 de novembro de 2026.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
