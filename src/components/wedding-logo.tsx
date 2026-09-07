import Image from 'next/image';

type WeddingLogoProps = { size?: 'navbar' | 'hero' | 'medium' };

export function WeddingLogo({ size = 'medium' }: WeddingLogoProps) {
  return <Image
    className={`wedding-logo wedding-logo--${size}`}
    src="/images/papelaria/Logo.png"
    alt="Paula & Erik — 21 de novembro de 2026. Eclesiastes 4:12."
    width={1254}
    height={1254}
    unoptimized
    preload={size === 'hero'}
  />;
}
