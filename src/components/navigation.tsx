'use client';
import { WeddingLogo } from './wedding-logo';
import { ArrowUpRightIcon } from './icons';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
const links = [['Início', '/#inicio'], ['Nossa história', '/#historia'], ['Pessoas especiais', '/#pessoas'], ['O grande dia', '/#dia'], ['Lista de Presentes', '/presentes']];
export function Navigation() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && open) { setOpen(false); button.current?.focus(); } }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, [open]);
  return <header className="site-header"><Link className="brand-link" href="/#inicio" aria-label="Paula e Erik — início"><WeddingLogo size="navbar" /></Link><button ref={button} className="menu-toggle" aria-expanded={open} aria-controls="navigation" onClick={() => setOpen(!open)}>{open ? 'Fechar ×' : 'Menu ☰'}</button><nav id="navigation" aria-label="Navegação principal" className={open ? 'navigation open' : 'navigation'}>{links.map(([label, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)}<a className="nav-rsvp" href="/rsvp" onClick={() => setOpen(false)}>Confirme sua presença <ArrowUpRightIcon /></a></nav></header>;
}
