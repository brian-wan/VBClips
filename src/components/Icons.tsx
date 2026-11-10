import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 22, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
)

export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
)

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" />
  </Svg>
)

export const Trash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
)

export const PlayIcon = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
  </Svg>
)

export const PauseIcon = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Svg>
)

export const FastForward = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M2 6.5v11a.8.8 0 0 0 1.25.66L11 12.66a.8.8 0 0 0 0-1.32L3.25 5.84A.8.8 0 0 0 2 6.5zM12 6.5v11a.8.8 0 0 0 1.25.66L21 12.66a.8.8 0 0 0 0-1.32l-7.75-5.5A.8.8 0 0 0 12 6.5z" />
  </Svg>
)

const SkipFive = ({ forward, ...p }: IconProps & { forward?: boolean }) => (
  <Svg {...p}>
    <g transform={forward ? 'translate(24 0) scale(-1 1)' : undefined}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4 3.5v3.7h3.7" />
    </g>
    <text
      x="12.3"
      y="15.6"
      textAnchor="middle"
      fontSize="8.5"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
      fontFamily="var(--font-family)"
    >
      5
    </text>
  </Svg>
)

export const Back5 = (p: IconProps) => <SkipFive {...p} />
export const Forward5 = (p: IconProps) => <SkipFive {...p} forward />

export const Volleyball = ({ size = 96 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill="var(--color-accent)" />
    <g fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round">
      <path d="M32 32c0-11 6-21 17-25" />
      <path d="M32 32c-9.5-5.5-21-5.5-29-1" />
      <path d="M32 32c9.5 5.5 15 15.5 13.5 27" />
      <path d="M22 6.5c2 9 8 17 18 21" />
      <path d="M5.5 45c8-5 18-6 26.5-2" />
      <path d="M60 30c-8 0-17 4-22 11" />
    </g>
  </svg>
)
