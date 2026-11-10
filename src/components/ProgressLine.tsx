import { clamp } from '../lib/clips'
import styles from './ProgressLine.module.css'

type Props = {
  /** 0..1, or null for work with nothing to measure (an indeterminate sweep). */
  value: number | null
  className?: string
  label?: string
}

/** A 2px accent line; the caller positions it with `className`. */
export function ProgressLine({ value, className = '', label }: Props) {
  const percent = value === null ? undefined : Math.round(clamp(value, 0, 1) * 100)
  return (
    <div
      className={`${styles.line} ${className}`}
      role="progressbar"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      {value === null ? (
        <div className={styles.sweep} />
      ) : (
        <div className={styles.fill} style={{ transform: `scaleX(${value})` }} />
      )}
    </div>
  )
}
