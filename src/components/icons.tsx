import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

export function ArrowUpRightIcon(props: IconProps) {
  return <svg {...iconProps} {...props}><path d="M4 12 12 4M6 4h6v6" /></svg>;
}

export function ArrowDownIcon(props: IconProps) {
  return <svg {...iconProps} {...props}><path d="M8 3v10M4.5 9.5 8 13l3.5-3.5" /></svg>;
}
