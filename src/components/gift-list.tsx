'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { formatGiftAmount, formatGoalAmount, formatGiftPercentage } from '@/lib/gifts/format';
import { clampPercentage } from '@/lib/gifts/progress';
import type { RegularGift, RegularGiftCategory } from '@/lib/gifts/types';
import { ArrowUpRightIcon } from './icons';
import { GiftContributionForm } from './gift-contribution-form';
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

function usesTransparentMedia(gift: RegularGift) {
  return gift.slug === 'ajudinha-ultimos-boletos';
}

function goalReached(gift: RegularGift) {
  return gift.funding_mode === 'goal' && !!gift.progress &&
    (gift.progress.goal_reached || clampPercentage(gift.progress.percentage) >= 100);
}

function GiftFunding({ gift }: { gift: RegularGift }) {
  if (gift.funding_mode === 'open') return <p className={styles.openAmount}>Contribua com o valor que desejar</p>;
  if (gift.funding_mode === 'fixed') return <p className={styles.price}>{formatGiftAmount(gift.target_amount)}</p>;
  const progress = gift.progress;
  const reached = goalReached(gift);
  const percentage = reached ? 100 : clampPercentage(progress?.percentage ?? 0);
  return <div className={styles.funding}>
    <p className={styles.goalAmount}>Meta: {formatGoalAmount(gift.target_amount!)}</p>
    {progress ? <>
      <div className={styles.progressTrack} role="progressbar" aria-label={`Progresso de ${gift.name}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
        <span className={styles.progressFill} style={{ width: `${percentage}%` }} />
      </div>
      <p className={styles.progressLabel}>{reached ? 'Meta alcançada ❤️' : `${formatGiftPercentage(percentage)} alcançado`}</p>
      <div className={styles.progressAmounts}>
        <p>{formatGoalAmount(progress.total_raised)} arrecadados</p>
        {progress.total_raised > 0 && !reached && <p>Faltam {formatGoalAmount(progress.remaining_amount)}</p>}
      </div>
    </> : <p className={styles.progressLabel}>Progresso temporariamente indisponível</p>}
  </div>;
}

function contributionBlocked(gift: RegularGift) {
  return gift.funding_mode === 'goal' && (!gift.progress || goalReached(gift));
}

function GiftCard({gift,onSelect}:{gift:RegularGift;onSelect:(gift:RegularGift)=>void}){
  const transparentMedia=usesTransparentMedia(gift);
  return <article className={styles.card}>
    <div className={`${styles.imageWrap} ${transparentMedia?styles.transparentMediaBackground:''}`}>{gift.image_url&&<Image className={transparentMedia?styles.transparentCardImage:undefined} src={gift.image_url} alt={gift.name} fill sizes="(max-width: 640px) 88vw, (max-width: 1000px) 42vw, 27vw" style={{objectFit:transparentMedia?'contain':'cover',objectPosition:imagePosition(gift)}} />}</div>
    <div className={styles.cardBody}>
      <p className={styles.category}>{categoryLabels[gift.category]}</p><h2>{gift.name}</h2>
      <GiftFunding gift={gift} />
      {!goalReached(gift) && <button type="button" className={styles.giftButton}
        disabled={contributionBlocked(gift)} onClick={()=>onSelect(gift)}>
        <span>{gift.funding_mode === 'goal' ? 'CONTRIBUIR COM ESTE SONHO' : 'CONTRIBUIR'}</span><ArrowUpRightIcon />
      </button>}
    </div>
  </article>;
}

export function GiftList({gifts}:{gifts:RegularGift[]}){
  const [category,setCategory]=useState<Category>('all');
  const [selected,setSelected]=useState<RegularGift|null>(null);
  const dialogRef=useRef<HTMLElement|null>(null);
  const closeButtonRef=useRef<HTMLButtonElement|null>(null);
  const triggerRef=useRef<HTMLElement|null>(null);
  const visible=category==='all'?gifts:gifts.filter(gift=>gift.category===category);
  useEffect(()=>{
    if(!selected)return;
    const previousOverflow=document.body.style.overflow;
    const returnFocus=triggerRef.current;
    document.body.style.overflow='hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        setSelected(null);
        return;
      }
      if(event.key!=='Tab'||!dialogRef.current)return;
      const focusable=[...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if(!focusable.length)return;
      const first=focusable[0];
      const last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    };
    window.addEventListener('keydown',handleKeyDown);
    return()=>{
      document.body.style.overflow=previousOverflow;
      window.removeEventListener('keydown',handleKeyDown);
      returnFocus?.focus();
    };
  },[selected]);
  function open(gift:RegularGift){if(contributionBlocked(gift))return;triggerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setSelected(gift)}
  function close(){setSelected(null)}
  return <>
    <div className={styles.filters} role="group" aria-label="Filtrar presentes por categoria">{categories.map(item=><button type="button" key={item.value} className={category===item.value?styles.filterActive:styles.filter} aria-pressed={category===item.value} onClick={()=>setCategory(item.value)}>{item.label}</button>)}</div>
    {category === 'travel' && <section className={styles.travelIntro} aria-labelledby="gramado-title">
      <h2 id="gramado-title">Nossa próxima aventura começa em Gramado.</h2>
      <p>Entre passeios, cafés, paisagens e momentos a dois, queremos construir lembranças que levaremos para toda a vida. Se quiser fazer parte dessa viagem, escolha um dos nossos sonhos e contribua com o valor que desejar.</p>
    </section>}
    <p className={styles.resultCount} aria-live="polite">{visible.length} {visible.length===1?'presente encontrado':'presentes encontrados'}</p>
    <section className={styles.grid} aria-label="Presentes disponíveis">{visible.map(gift=><GiftCard key={gift.id} gift={gift} onSelect={open} />)}</section>
    {selected&&<div className={styles.backdrop} role="presentation" onMouseDown={close}><section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="gift-detail-title" aria-describedby="gift-detail-description" onMouseDown={event=>event.stopPropagation()}>
      <button ref={closeButtonRef} className={styles.close} type="button" aria-label="Fechar detalhes do presente" onClick={close}>×</button>
      <div className={`${styles.modalImage} ${usesTransparentMedia(selected)?styles.transparentMediaBackground:''}`}><div className={styles.modalImageArt}>{selected.image_url&&<Image className={`${styles.modalImageAsset} ${usesTransparentMedia(selected)?styles.transparentModalImage:''}`} src={selected.image_url} alt={selected.name} fill sizes="(max-width: 640px) 88vw, (max-width: 900px) 500px, 534px" style={{objectPosition:imagePosition(selected)}} />}</div></div>
      <div className={styles.modalBody}>
        <p className={styles.category}>{categoryLabels[selected.category]}</p>
        <h2 id="gift-detail-title">{selected.name}</h2>
        <div className={styles.modalFunding}><GiftFunding gift={selected} /></div>
        <p id="gift-detail-description" className={styles.description}>{selected.description??''}</p>
        <div className={styles.modalForm}><GiftContributionForm gift={selected} /></div>
      </div>
    </section></div>}
  </>;
}
