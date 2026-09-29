import { useId } from 'react'

/**
 * Marca do SysFinan: escudo com setas circulares e documento com checklist.
 * As cores das classes mk-* ficam em styles.css (tokens --marca-*), então
 * acompanham o tema do app. É o mesmo desenho de public/favicon.svg.
 */
export default function Marca({ tamanho = 32 }: { tamanho?: number }) {
  // useId devolve ":r0:"; dois-pontos quebram a referência url(#...).
  const id = 'marca' + useId().replace(/:/g, '')

  return (
    <svg
      className="marca-simbolo"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
      <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0.35"><stop offset="0.35" className="mk-e0"/><stop offset="0.65" className="mk-e1"/></linearGradient>
      <mask id={`${id}k`}><rect width="100" height="100" fill="#fff"/>
      <g fill="none" stroke="#000" strokeWidth="13.5"><path d="M42.11 82.46A30.5 30.5 0 0 1 42.11 23.54"/><path d="M59.43 23.99A30.5 30.5 0 0 1 75.87 69.16"/></g>
      <g fill="#000" stroke="#000" strokeWidth="5" strokeLinejoin="round"><path d="M54.18 20.3L40.04 15.81L44.18 31.27Z"/><path d="M69.24 79.76L82.65 73.4L69.08 64.92Z"/></g></mask>
      </defs>
      <path d="M50 7L87 18V47C87 71 70 86 50 95C30 86 13 71 13 47V18Z" fill="none" stroke={`url(#${id}g)`} strokeWidth="7" strokeLinejoin="round" mask={`url(#${id}k)`}/>
      <path d="M42.11 82.46A30.5 30.5 0 0 1 42.11 23.54" fill="none" className="mk-as" strokeWidth="7.5"/>
      <path d="M54.18 20.3L40.04 15.81L44.18 31.27Z" className="mk-a"/>
      <path d="M59.43 23.99A30.5 30.5 0 0 1 75.87 69.16" fill="none" className="mk-vs" strokeWidth="7.5"/>
      <path d="M69.24 79.76L82.65 73.4L69.08 64.92Z" className="mk-v"/>
      <g fill="none" className="mk-ds" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
      <path d="M38 37.5a3 3 0 0 1 3-3H56.5L63.5 41.5V67a3 3 0 0 1-3 3H41a3 3 0 0 1-3-3Z"/><path d="M56.5 34.5V41.5H63.5"/><path d="M42.5 45h5v5h-5ZM42.5 55h5v5h-5Z" strokeWidth="2"/><path d="M51 47.5H59.5M51 52H56.5M51 57.5H59.5" strokeWidth="2.4"/>
      </g>
      <path d="M42.8 47.3l2.1 2.2 4.6-5.4" fill="none" className="mk-vs" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
