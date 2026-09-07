import Image, { type ImageProps } from 'next/image';

type DreamPhotoProps = ImageProps & { objectPosition?: string };

export function DreamPhoto({ objectPosition = '50% 50%', className = '', style, alt, ...props }: DreamPhotoProps) {
  return <Image {...props} alt={alt} className={`dream-photo ${className}`} style={{ ...style, objectPosition }} />;
}
