import { useCoarsePointer } from '../hooks/useCoarsePointer'
import ui from './ui.module.css'

type Props = { label: string; keys?: readonly string[] }

/**
 * Tooltip bubble for a parent with `ui.tip`; each key renders as a `<kbd>` chip after the label.
 * Nothing on touch, where there is no hover; the controls' `aria-label`s carry the names.
 */
export function Tip({ label, keys = [] }: Props) {
  const coarse = useCoarsePointer()
  if (coarse) return null
  return (
    <span className={ui.tipBubble} aria-hidden="true">
      {label}
      {keys.map((key) => (
        <kbd key={key} className={ui.kbd}>
          {key}
        </kbd>
      ))}
    </span>
  )
}
