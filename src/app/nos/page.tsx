import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Navigation } from '@/components/navigation';
import { ArrowRightIcon } from '@/components/icons';
import styles from './nos.module.css';

export const metadata: Metadata = {
  title: 'Nós — Paula & Erik',
  description: 'Paula & Erik. Entre todos os caminhos.',
};

const photographs = {
  6: { width: 4160, height: 6240, alt: 'Paula e Erik rindo juntos, abraçados no sofá.' },
  14: { width: 4160, height: 6240, alt: 'Paula sentada em uma cadeira de madeira, com Erik ao seu lado, entre as plantas da sala.' },
  1: { width: 6125, height: 4083, alt: 'Paula e Erik preparando o café da manhã juntos à mesa.' },
  2: { width: 6240, height: 4160, alt: 'Detalhe das mãos passando manteiga no pão à mesa do café.' },
  3: { width: 4160, height: 6240, alt: 'Paula e Erik em um abraço apertado no sofá.' },
  8: { width: 4160, height: 6240, alt: 'Paula girando com a mão erguida enquanto dança com Erik na sala.' },
  9: { width: 4160, height: 6240, alt: 'Paula e Erik de mãos dadas, dançando e rindo na sala.' },
  18: { width: 5988, height: 3992, alt: 'Paula sorri segurando uma bandeja, enquanto Erik aparece refletido no espelho do quarto.' },
  21: { width: 4076, height: 6114, alt: 'Paula e Erik se aproximam para um beijo na cama, junto à bandeja do café.' },
  26: { width: 6240, height: 4160, alt: 'Erik lê uma carta enquanto Paula sorri emocionada, com as mãos junto ao rosto.' },
  27: { width: 6240, height: 4160, alt: 'Paula lê uma carta escrita à mão enquanto Erik sorri ao seu lado.' },
  31: { width: 4160, height: 6240, alt: 'Paula e Erik olham juntos para os cordões e objetos que seguram nas mãos.' },
  32: { width: 6080, height: 4053, alt: 'Paula e Erik se abraçam na cama, com cartas e lembranças ao lado.' },
  16: { width: 4160, height: 6240, alt: 'Fotografia em preto e branco de Erik abraçando Paula junto à janela.' },
  33: { width: 3857, height: 5786, alt: 'Paula sentada no chão, acolhida no abraço de Erik, com um buquê ao lado.' },
} as const;

function Photograph({ number, className, sizes, opening = false }: {
  number: keyof typeof photographs;
  className: string;
  sizes: string;
  opening?: boolean;
}) {
  return (
    <figure className={`${styles.photograph} ${className}`}>
      <Image
        src={`/images/casal/pe-${number}.jpg`}
        width={photographs[number].width}
        height={photographs[number].height}
        alt={photographs[number].alt}
        style={{ aspectRatio: `${photographs[number].width} / ${photographs[number].height}` }}
        sizes={sizes}
        // Next 16 replaces priority with preload. Only the opening is preloaded.
        preload={opening}
        loading={opening ? undefined : 'lazy'}
      />
    </figure>
  );
}

export default function NosPage() {
  return (
    <>
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <Navigation />
      <main id="conteudo" className={styles.page}>
        <section className={styles.opening} aria-labelledby="nos-title">
          <div className={styles.openingCopy}>
            <h1 id="nos-title">Nós.</h1>
            <p>Paula &amp; Erik</p>
          </div>
          <Photograph number={6} className={styles.heroPhoto} sizes="(max-width: 600px) 88vw, (max-width: 900px) 59vw, (max-width: 1199px) 48vw, (max-width: 1440px) 46vw, 662px" opening />
        </section>

        <div className={styles.introduction}>
          <span className={styles.rule} aria-hidden="true" />
          <p>Entre todos os caminhos.</p>
          {/* Futuro texto: introdução escrita pelo casal. */}
        </div>

        <div className={styles.everyday}>
          <Photograph number={14} className={styles.roomPortrait} sizes="(max-width: 600px) 76vw, (max-width: 1440px) 40vw, 576px" />
          <Photograph number={1} className={styles.breakfast} sizes="(max-width: 600px) 88vw, (max-width: 1440px) 48vw, 691px" />
          <Photograph number={2} className={styles.bread} sizes="(max-width: 600px) 62vw, (max-width: 1440px) 31vw, 446px" />
        </div>

        {/* Futuro texto: aproximação e vida compartilhada, nas palavras do casal. */}
        <Photograph number={3} className={styles.closeEmbrace} sizes="(max-width: 600px) 80vw, (max-width: 1440px) 44vw, 634px" />

        <div className={styles.dance}>
          <Photograph number={8} className={styles.turn} sizes="(max-width: 600px) 74vw, (max-width: 1440px) 37vw, 533px" />
          <Photograph number={9} className={styles.laughter} sizes="(max-width: 600px) 88vw, (max-width: 1440px) 46vw, 662px" />
        </div>

        <div className={styles.morning}>
          <Photograph number={18} className={styles.reflection} sizes="(max-width: 600px) 92vw, (max-width: 900px) 72vw, (max-width: 1440px) 66vw, 950px" />
          <Photograph number={21} className={styles.kiss} sizes="(max-width: 600px) 78vw, (max-width: 900px) 41vw, (max-width: 1440px) 36vw, 518px" />
        </div>

        {/* Futuro texto: cartas e lembranças. Não atribuir significado aos objetos sem o relato do casal. */}
        <div className={styles.letters}>
          <Photograph number={26} className={styles.letterReaction} sizes="(max-width: 600px) 92vw, (max-width: 1199px) 82vw, (max-width: 1440px) 84vw, 1210px" />
          <Photograph number={27} className={styles.letterReading} sizes="(max-width: 600px) 88vw, (max-width: 1440px) 58vw, 835px" />
        </div>

        <Photograph number={31} className={styles.keepsakes} sizes="(max-width: 600px) 78vw, (max-width: 900px) 48vw, (max-width: 1440px) 40vw, 576px" />
        <Photograph number={32} className={styles.intimacy} sizes="(max-width: 600px) 92vw, (max-width: 1199px) 78vw, (max-width: 1440px) 80vw, 1152px" />
        <Photograph number={16} className={styles.quiet} sizes="(max-width: 600px) 74vw, (max-width: 900px) 48vw, (max-width: 1199px) 46vw, (max-width: 1440px) 48vw, 691px" />

        <section className={styles.ending} aria-labelledby="ending-title">
          <Photograph number={33} className={styles.lastPhoto} sizes="(max-width: 600px) 86vw, (max-width: 900px) 58vw, (max-width: 1199px) 53vw, (max-width: 1440px) 56vw, 806px" />
          <div className={styles.signature}>
            <h2 id="ending-title">E continuo escolhendo você.</h2>
            <p className="handwritten">Paula &amp; Erik</p>
          </div>
        </section>
        <footer className={styles.footer}>
          <Link href="/" prefetch={false} className={styles.returnLink}><ArrowRightIcon /> Voltar à Home</Link>
        </footer>
      </main>
    </>
  );
}
