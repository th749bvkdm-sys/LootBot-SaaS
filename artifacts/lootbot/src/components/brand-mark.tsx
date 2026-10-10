import { useId } from 'react';

/** One vector mark for product surfaces, including a single-colour print fallback. */
export function BrandMark({ small = false, monochrome = false, className = '' }: { small?: boolean; monochrome?: boolean; className?: string }) {
  const gradient = `lootbot-${useId().replace(/:/g, '')}`;
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 48 48" className={`brand-mark ${small ? 'h-7 w-7' : 'h-10 w-10'} shrink-0 ${className}`}>
    <defs><linearGradient id={gradient} x1="7" y1="7" x2="41" y2="43" gradientUnits="userSpaceOnUse"><stop stopColor="#aa91ef"/><stop offset=".48" stopColor="#8477de"/><stop offset="1" stopColor="#669ddd"/></linearGradient></defs>
    <path d="M11 7h12v22h18v12H11z" fill={monochrome ? 'currentColor' : `url(#${gradient})`}/>
    <path d="M11 7l4 4v26l-4 4z" fill={monochrome ? 'currentColor' : '#cfc6ff'} opacity=".45"/>
    <path d="M15 37h22l4 4H11z" fill={monochrome ? 'currentColor' : '#385f9f'} opacity=".7"/>
    <path d="M23 29l-4 4h18l4-4z" fill={monochrome ? 'currentColor' : '#d5dcff'} opacity=".42"/>
  </svg>;
}
