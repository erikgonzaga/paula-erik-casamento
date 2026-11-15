import type { Metadata } from 'next';
import Image from 'next/image';
import styles from './menu-buffet.module.css';

export const metadata: Metadata = {
  title: 'Menu do casamento — Paula & Erik',
  description: 'Menu do churrasco de Paula e Erik, 21 de novembro de 2026.',
  robots: { index: false, follow: false },
};

type MenuSection = {
  title: string;
  note?: string;
  items: readonly { name: string; description?: string }[];
};

const leftSections: readonly MenuSection[] = [
  {
    title: 'Entradas',
    items: [
      { name: 'Stick Napolitano' },
      {
        name: 'Palitos de massa folhada',
        description: 'temperada com ervas – servido em mini copo com dip especial',
      },
      { name: 'Dadinho de tapioca com melaço de cana' },
    ],
  },
  {
    title: 'Salgados',
    items: [
      { name: 'Coxinha' },
      { name: 'Ouriço de queijo' },
      { name: 'Guioza de camarão' },
      { name: 'Bombom de carne' },
      { name: 'Mini quiche de alho poró' },
      { name: 'Bolinho de bacalhau' },
    ],
  },
  {
    title: 'Mesa buffet',
    items: [
      { name: 'Mandioca frita cremosa' },
      { name: 'Batata frita com cheddar e bacon' },
      { name: 'Torresminho' },
      { name: 'Salame italiano e hamburguês fatiado' },
      { name: 'Caldinho de feijão temperado' },
      { name: 'Guacamole com nachos' },
      { name: 'Escabeche de berinjela' },
      { name: 'Sunomono' },
      { name: 'Cuscuz Paulista' },
      { name: 'Salada verde' },
      { name: 'Salada de batata' },
      { name: 'Arroz branco' },
      { name: 'Farofa de banana da terra' },
      { name: 'Pãozinho de alho' },
    ],
  },
];

const rightSections: readonly MenuSection[] = [
  {
    title: 'Carnes servidas na chapa quente',
    note: 'Acompanha pão francês e vinagrete.',
    items: [
      { name: 'Picanha filetada', description: '(acompanha molho de alho)' },
      { name: 'Alcatra filetada', description: '(acompanha molho de alho)' },
      { name: 'Tulipas de frango' },
      { name: 'Linguiça toscana' },
    ],
  },
  {
    title: 'Sobremesa',
    items: [{ name: 'Brownie com sorvete de creme e calda de chocolate' }],
  },
  {
    title: 'Bebidas',
    items: [
      { name: 'Coca-Cola (normal e zero)' },
      { name: 'Guaraná' },
      { name: 'Suco de laranja' },
      { name: 'Suco de uva' },
      { name: 'Água mineral (com e sem gás)' },
    ],
  },
  { title: 'Balada', items: [{ name: 'Algodão doce' }] },
  { title: 'Encerramento', items: [{ name: 'Café expresso e petit four' }] },
];

function MenuCategory({ title, note, items }: MenuSection) {
  return (
    <section className={styles.category}>
      <h2 className={styles.categoryTitle}><span>{title}</span></h2>
      {note && <p className={styles.note}>{note}</p>}
      <ul className={styles.items}>
        {items.map(item => (
          <li key={item.name}>
            <span className={styles.dish}>{item.name}</span>
            {item.description && <em className={styles.description}>{item.description}</em>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MenuBuffetPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Image className={`${styles.floral} ${styles.floralLeft}`}
          src="/images/papelaria/Floral_Canto_Intenso_Transparente.png"
          alt="" aria-hidden="true" width={1023} height={1537} sizes="(max-width: 700px) 110px, 260px" />
        <Image className={`${styles.floral} ${styles.floralRight}`}
          src="/images/papelaria/Floral_Canto_Intenso_Transparente.png"
          alt="" aria-hidden="true" width={1023} height={1537} sizes="(max-width: 700px) 110px, 260px" />
        <div className={styles.heading}>
          <Image className={styles.names} src="/images/papelaria/Paula_Erik_Nomes_Coracao_Transparente.png"
            alt="Paula & Erik" width={2132} height={738} sizes="(max-width: 700px) 230px, 360px" preload />
          <p className={styles.date}><time dateTime="2026-11-21">21 DE NOVEMBRO DE 2026</time></p>
          <h1 className={styles.title}>Menu</h1>
          <Image className={styles.ornament} src="/images/papelaria/Ornamento_Ramos_Coracao.png"
            alt="" aria-hidden="true" width={1983} height={793} sizes="180px" />
          <p className={styles.intro}>Um dia inteiro para celebrar o amor e estar junto.</p>
        </div>
      </header>

      <div className={styles.columns}>
        <div className={styles.column}>{leftSections.map(section => <MenuCategory key={section.title} {...section} />)}</div>
        <div className={styles.column}>{rightSections.map(section => <MenuCategory key={section.title} {...section} />)}</div>
      </div>

      <footer className={styles.footer}>
        <Image className={styles.ornament} src="/images/papelaria/Ornamento_Ramos_Coracao.png"
          alt="" aria-hidden="true" width={1983} height={793} sizes="180px" />
        <Image className={styles.landscape} src="/images/papelaria/rodape_site.png"
          alt="Montanhas em aquarela e os dizeres: Paula & Erik. Juntos, sempre mais longe."
          width={1848} height={851} sizes="(max-width: 700px) 90vw, 680px" />
        <p className={styles.verse}>ECLESIASTES 4:12</p>
      </footer>
    </main>
  );
}
