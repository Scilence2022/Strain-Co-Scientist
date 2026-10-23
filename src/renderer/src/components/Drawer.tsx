import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconClose } from './Icons'

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  actions,
  wide = false
}: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = ref.current!
    const focusable = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
        )
      ].filter((el) => el.getClientRects().length)
    ;(focusable()[0] ?? panel).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
      if (e.key === 'Tab') {
        const items = focusable()
        const first = items[0],
          last = items[items.length - 1]
        if (!first) {
          e.preventDefault()
          panel.focus()
        } else if (!panel.contains(document.activeElement)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus()
        } else if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === panel)
        ) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div
        ref={ref}
        className={`drawer ${wide ? 'drawer-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId}>{title}</h2>
            {subtitle && (
              <div className="muted" style={{ marginTop: 6 }}>
                {subtitle}
              </div>
            )}
          </div>
          {actions}
          <button className="btn btn-icon btn-ghost" aria-label="Close dialog" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
