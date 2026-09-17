'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { formatGiftAmount } from '@/lib/gifts/format';
import type { RegularGift, RegularGiftCategory } from '@/lib/gifts/types';
import { ArrowUpRightIcon } from './icons';
import styles from './gift-list.module.css';

type Category = 'all' | RegularGiftCategory;

const categories: { value: Category; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'party', label: 'Festa' },
  { value: 'house', label: 'Casa' },
  { value: 'travel', label: 'Viagem' },
];

const categoryLabels: Record<RegularGiftCategory, string> = {
  party: 'Festa',
  house: 'Casa',
  travel: 'Viagem',
};

const imagePositions: Record<string, string> = {
  'mesa-domingos': '50% 55%',
  'cantinho-cafe': '50% 40%',
  'enxoval-lar': '50% 48%',
  'combustivel-estradas': '50% 48%',
  'jantar-cidade-nova': '50% 47%',
  'experiencia-recordar': '50% 48%',
  'mala-novos-capitulos': '50% 48%',
  'tempo-so-nosso': '50% 42%',
  'detalhes-celebrar': '50% 60%',
};

function imagePosition(gift: RegularGift) {
  return imagePositions[gift.slug] ?? '50% 50%';
}

function GiftCard({gift,onSelect}:{gift:RegularGift;onSelect:(gift:RegularGift)=>void}){
  return <article className={styles.card}>
    <div className={styles.imageWrap}>{gift.image_url&&<Image src={gift.image_url} alt="" fill sizes="(max-width: 640px) 88vw, (max-width: 1000px) 42vw, 27vw" style={{objectFit:'cover',objectPosition:imagePosition(gift)}} />}</div>
    <div className={styles.cardBody}><p className={styles.category}>{categoryLabels[gift.category]}</p><h2>{gift.name}</h2><p className={styles.price}>{formatGiftAmount(gift.target_amount)}</p><button type="button" className={styles.giftButton} onClick={()=>onSelect(gift)}>Presentear <ArrowUpRightIcon /></button></div>
  </article>;
}

export function GiftList({gifts}:{gifts:RegularGift[]}){
  const [category,setCategory]=useState<Category>('all');
  const [selected,setSelected]=useState<RegularGift|null>(null);
  const [continued,setContinued]=useState(false);
  const visible=category==='all'?gifts:gifts.filter(gift=>gift.category===category);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
  function open(gift:RegularGift){setContinued(false);setSelected(gift)}
  return <>
    <div className={styles.filters} role="group" aria-label="Filtrar presentes por categoria">{categories.map(item=><button type="button" key={item.value} className={category===item.value?styles.filterActive:styles.filter} aria-pressed={category===item.value} onClick={()=>setCategory(item.value)}>{item.label}</button>)}</div>
    <p className={styles.resultCount} aria-live="polite">{visible.length} {visible.length===1?'presente encontrado':'presentes encontrados'}</p>
    <section className={styles.grid} aria-label="Presentes disponíveis">{visible.map(gift=><GiftCard key={gift.id} gift={gift} onSelect={open} />)}</section>
    {selected&&<div className={styles.backdrop} role="presentation" onMouseDown={()=>setSelected(null)}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="gift-detail-title" onMouseDown={event=>event.stopPropagation()}>
      <button className={styles.close} type="button" aria-label="Fechar detalhes do presente" onClick={()=>setSelected(null)}>×</button>
      <div className={styles.modalImage}>{selected.image_url&&<Image src={selected.image_url} alt="" fill sizes="(max-width: 640px) 88vw, 460px" style={{objectFit:'cover',objectPosition:imagePosition(selected)}} />}</div>
      <div className={styles.modalBody}><p className={styles.category}>{categoryLabels[selected.category]}</p><h2 id="gift-detail-title">{selected.name}</h2><p className={styles.price}>{formatGiftAmount(selected.target_amount)}</p><p className={styles.description}>{selected.description??''}</p>{continued?<p className={styles.notice} role="status">Em breve, você poderá escolher PIX ou pagamento parcelado por aqui.</p>:<button type="button" className={styles.continue} onClick={()=>setContinued(true)}>Continuar <ArrowUpRightIcon /></button>}</div>
    </section></div>}
  </>;
}
