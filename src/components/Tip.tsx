import ui from './ui.module.css'

type Props = { label: string; keys?: readonly string[] }

/** Tooltip bubble for a parent with `ui.tip`; each key renders as a `<kbd>` chip after the label. */
export function Tip({ label, keys = [] }: Props) {
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
