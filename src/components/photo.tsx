import { DreamPhoto } from './dream-photo';
type Props = { caption: string; className?: string; number?: string };
const photos: Record<string, { src: string; alt: string }> = {
  '01': { src: '/images/casal/pe-12.jpg', alt: 'Paula e Erik trocando um olhar e um carinho no rosto, em casa.' },
  '02': { src: '/images/casal/pe-9.jpg', alt: 'Paula e Erik dançando e rindo na sala.' },
  '03': { src: '/images/casal/pe-15.jpg', alt: 'Erik abraça Paula diante da janela iluminada pelo sol.' },
};
export function Photo({ caption, className = '', number = '01' }: Props) {
  const photo = photos[number];
  return <figure className={`photo ${className}`}><div className="photo-surface"><DreamPhoto objectPosition={number === '01' ? '50% 45%' : '50% 50%'} src={photo.src} alt={photo.alt} fill sizes="(max-width: 600px) 88vw, 44vw" preload={number === '01'} /></div><figcaption><span>{number} / {caption}</span><span aria-hidden="true">↗</span></figcaption></figure>;
}
