'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ArrowUpRightIcon } from './icons';
import styles from './gift-list.module.css';

type Category = 'Todos' | 'Casa' | 'Viagem' | 'Roupas e Acessórios';
type Gift = { id:string; name:string; price:string; category:Exclude<Category,'Todos'>; description:string; image:string; position:string };

const categories:Category[]=['Todos','Casa','Viagem','Roupas e Acessórios'];
const gifts:Gift[]=[
  {id:'mesa',name:'Mesa para os nossos domingos',price:'R$ 280,00',category:'Casa',description:'Um gesto para os almoços demorados, as conversas e as novas memórias que queremos criar em casa.',image:'/images/casal/pe-26.jpg',position:'50% 55%'},
  {id:'cafe',name:'Cantinho do café',price:'R$ 180,00',category:'Casa',description:'Para começar os dias devagar, com café quente e companhia boa.',image:'/images/casal/pe-33.jpg',position:'50% 40%'},
  {id:'lencois',name:'Enxoval para o nosso lar',price:'R$ 240,00',category:'Casa',description:'Um carinho para deixar o nosso quarto ainda mais acolhedor.',image:'/images/casal/pe-32.jpg',position:'50% 48%'},
  {id:'estrada',name:'Combustível para novas estradas',price:'R$ 200,00',category:'Viagem',description:'Uma contribuição para os próximos caminhos, paisagens e histórias a dois.',image:'/images/casal/pe-9.jpg',position:'50% 48%'},
  {id:'jantar',name:'Jantar em uma cidade nova',price:'R$ 320,00',category:'Viagem',description:'Para brindar a vida em algum lugar que ainda vamos descobrir juntos.',image:'/images/casal/pe-22.jpg',position:'50% 47%'},
  {id:'experiencia',name:'Uma experiência para recordar',price:'R$ 450,00',category:'Viagem',description:'Para transformar uma viagem em uma lembrança que ficará conosco para sempre.',image:'/images/casal/pe-15.jpg',position:'50% 48%'},
  {id:'mala',name:'Mala para novos capítulos',price:'R$ 390,00',category:'Roupas e Acessórios',description:'Para acompanhar o que ainda vamos viver, perto ou longe de casa.',image:'/images/casal/pe-6.jpg',position:'50% 48%'},
  {id:'relogio',name:'Um tempo só nosso',price:'R$ 260,00',category:'Roupas e Acessórios',description:'Um presente para celebrar o tempo compartilhado e tudo o que vem pela frente.',image:'/images/casal/pe-12.jpg',position:'50% 42%'},
  {id:'flor',name:'Detalhes para celebrar',price:'R$ 150,00',category:'Roupas e Acessórios',description:'Um pequeno gesto para os detalhes bonitos que queremos levar para a nossa rotina.',image:'/images/casal/pe-33.jpg',position:'50% 60%'},
];

function GiftCard({gift,onSelect}:{gift:Gift;onSelect:(gift:Gift)=>void}){
  return <article className={styles.card}>
    <div className={styles.imageWrap}><Image src={gift.image} alt="" fill sizes="(max-width: 640px) 88vw, (max-width: 1000px) 42vw, 27vw" style={{objectFit:'cover',objectPosition:gift.position}} /></div>
    <div className={styles.cardBody}><p className={styles.category}>{gift.category}</p><h2>{gift.name}</h2><p className={styles.price}>{gift.price}</p><button type="button" className={styles.giftButton} onClick={()=>onSelect(gift)}>Presentear <ArrowUpRightIcon /></button></div>
  </article>;
}

export function GiftList(){
  const [category,setCategory]=useState<Category>('Todos');
  const [selected,setSelected]=useState<Gift|null>(null);
  const [continued,setContinued]=useState(false);
  const visible=category==='Todos'?gifts:gifts.filter(gift=>gift.category===category);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
  function open(gift:Gift){setContinued(false);setSelected(gift)}
  return <>
    <div className={styles.filters} role="group" aria-label="Filtrar presentes por categoria">{categories.map(item=><button type="button" key={item} className={category===item?styles.filterActive:styles.filter} aria-pressed={category===item} onClick={()=>setCategory(item)}>{item}</button>)}</div>
    <p className={styles.resultCount} aria-live="polite">{visible.length} {visible.length===1?'presente encontrado':'presentes encontrados'}</p>
    <section className={styles.grid} aria-label="Presentes disponíveis">{visible.map(gift=><GiftCard key={gift.id} gift={gift} onSelect={open} />)}</section>
    {selected&&<div className={styles.backdrop} role="presentation" onMouseDown={()=>setSelected(null)}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="gift-detail-title" onMouseDown={event=>event.stopPropagation()}>
      <button className={styles.close} type="button" aria-label="Fechar detalhes do presente" onClick={()=>setSelected(null)}>×</button>
      <div className={styles.modalImage}><Image src={selected.image} alt="" fill sizes="(max-width: 640px) 88vw, 460px" style={{objectFit:'cover',objectPosition:selected.position}} /></div>
      <div className={styles.modalBody}><p className={styles.category}>{selected.category}</p><h2 id="gift-detail-title">{selected.name}</h2><p className={styles.price}>{selected.price}</p><p className={styles.description}>{selected.description}</p>{continued?<p className={styles.notice} role="status">Em breve, você poderá escolher PIX ou pagamento parcelado por aqui.</p>:<button type="button" className={styles.continue} onClick={()=>setContinued(true)}>Continuar <ArrowUpRightIcon /></button>}</div>
    </section></div>}
  </>;
}
