import { goTo, isPlainClick } from './routing.ts'

/** A real link, so it opens in a new tab too, followed in place otherwise. */
export function AppLink({
  href,
  className,
  label,
  children,
}: {
  href: string
  className?: string
  /** Its name, for a link whose content is a glyph: said by the screen reader, shown on hover. */
  label?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      title={label}
      onClick={(event) => {
        if (!isPlainClick(event)) return
        event.preventDefault()
        goTo(href)
      }}
    >
      {children}
    </a>
  )
}
