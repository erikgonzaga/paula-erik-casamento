import Image from 'next/image';
import Link from 'next/link';
import { Navigation } from '@/components/navigation';
import { GiftList } from '@/components/gift-list';
import { formatGiftAmount } from '@/lib/gifts/format';
import { isInsaneGift, isRegularGift } from '@/lib/gifts/types';
import { getActiveGifts } from '@/services/gifts';
import styles from './presentes.module.css';

export const dynamic = 'force-dynamic';

const insaneButtonClasses: Record<string, string> = {
  'moeda-bronze': styles.buttonBronze,
  'moeda-prata': styles.buttonPrata,
  'moeda-ouro': styles.buttonOuro,
};

function MedalTitle({ name }: { name: string }) {
  const parts = name.match(/^(Presente Insano) (— Medalha (?:Bronze|Prata|Ouro))$/i);
  return <h3>{parts ? <>
    <span className={styles.medalTitleLine}>{parts[1].toUpperCase()}</span>{' '}
    <span className={styles.medalTitleLine}>{parts[2].replace(/^—\s*/, '').toUpperCase()}</span>
  </> : name.toUpperCase()}</h3>;
}

function MotorcycleIcon() {
  return (
    <svg viewBox="0 0 64 32" aria-hidden="true" focusable="false">
      <circle cx="14" cy="23" r="7" />
      <circle cx="50" cy="23" r="7" />
      <path d="M14 23h13l7-11h8l8 11M27 23 20 12h10l8 11M39 8h8M33 12l-4-5h-5" />
    </svg>
  );
}

export default async function PresentsPage() {
  const gifts = await getActiveGifts();
  const regularGifts = gifts.filter(isRegularGift);
  const insaneGifts = gifts.filter(isInsaneGift);

  return (
    <>
      <a className="skip-link" href="#conteudo-presentes">
        Pular para o conteúdo
      </a>
      <Navigation />
      <main id="conteudo-presentes" className={styles.page}>
        <section className={`${styles.hero} section-shell`}>
          <Image
            className={styles.heroFloral}
            src="/images/papelaria/Floral_Canto_Intenso_Transparente.png"
            alt=""
            aria-hidden="true"
            width={750}
            height={1200}
          />
          <p className="eyebrow">PAULA &amp; ERIK · 21.11.2026</p>
          <h1>
            Lista de <em>Presentes</em>
          </h1>
          <p>
            Criamos esta lista com muito carinho, com itens que vão nos ajudar a construir o nosso lar, viver novas
            experiências e começar essa nova fase juntos.
          </p>
          <p>Fique à vontade para escolher o presente que mais fizer sentido para você.</p>
        </section>

        <section className={`${styles.catalog} section-shell`}>
          <div className={styles.catalogHeading}>
            <p className="eyebrow">UM CARINHO PARA O NOSSO NOVO COMEÇO</p>
            <h2>
              Para os dias que
              <br />
              <em>vêm pela frente.</em>
            </h2>
          </div>
          <GiftList gifts={regularGifts} />
        </section>

        <section className={styles.insane} aria-labelledby="presentes-insanos-title">
          <div className={`${styles.insaneInner} section-shell`}>
            <div className={styles.insaneCopy}>
              <p className={styles.insaneEyebrow}>PRESENTES</p>
              <h2 id="presentes-insanos-title" className={styles.insaneTitle}>
                INSANOS
              </h2>
              <span className={styles.insaneDivider} aria-hidden="true" />
              <p className={styles.insaneDescription}>
                Para os irmãos da nossa Regional, criamos três opções simbólicas para quem quiser contribuir com essa
                nova fase da nossa história. Toda ajuda é bem-vinda e faz parte dessa jornada!
              </p>
              <p className={styles.insaneSignature}>Gratidão, irmãos!</p>
            </div>

            <div className={styles.medals}>
              {insaneGifts.map((gift) => (
                <article key={gift.id} className={styles.medalCard}>
                  <MedalTitle name={gift.name} />
                  <div className={styles.medalImage}>
                    {gift.image_url&&<Image
                      src={gift.image_url}
                      alt={`${gift.name} dos Presentes Insanos`}
                      fill
                      unoptimized
                      sizes="(max-width: 700px) 68vw, (max-width: 1100px) 24vw, 210px"
                    />}
                  </div>
                  <div className={styles.medalDetails}>
                    <p className={styles.medalLabel}>PRESENTE INSANO</p>
                    <p className={styles.medalDescription}>{gift.description??''}</p>
                    <p className={styles.medalPrice}>{formatGiftAmount(gift.target_amount)}</p>
                    <button id={`contribuir-${gift.slug.replace(/^moeda-/, '')}`} className={insaneButtonClasses[gift.slug]??styles.buttonBronze} type="button">
                      CONTRIBUIR
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className={styles.insaneClosing}>
              <div className={styles.motorcycleDivider} aria-hidden="true">
                <span />
                <MotorcycleIcon />
                <span />
              </div>
              <p>
                MAIS QUE PRESENTES,
                <br />
                CONQUISTAS COMPARTILHADAS.
              </p>
              <span className={styles.closingAccent} aria-hidden="true" />
            </div>
          </div>
        </section>

        <section className={`${styles.return} section-shell`}>
          <p className="eyebrow">COM CARINHO</p>
          <h2>
            Obrigada por fazer parte
            <br />
            da nossa <em>história.</em>
          </h2>
          <Link href="/#inicio">Voltar ao início</Link>
        </section>
      </main>
    </>
  );
}
