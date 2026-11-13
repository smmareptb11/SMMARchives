import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'

import { escapeCloses } from './escape.ts'
import type { Detail } from './useWindows.ts'
import { useFloating, type Drag } from './useFloating.ts'
import { cascadeOf, type Window } from './windows.ts'

/**
 * A window over the map: a title bar it is moved by, a cross that closes it, what
 * it is about under them, and a corner it is resized by. Any press on it brings
 * it in front.
 */
export function FloatingWindow({
  window: { key, subject, rank, step },
  front,
  detail,
  title,
  subtitle,
  children,
}: {
  window: Window
  /** In front of the other windows: the one Escape closes. */
  front: boolean
  detail: Detail
  title: string
  subtitle: string | undefined
  children: ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  const titleId = useId()
  const onClose = useCallback(() => {
    detail.close(key)
  }, [detail, key])
  useEscape(onClose, front)
  const { style, moving, drag, sized, resize } = useFloating(panel, cascadeOf(step))
  const className = [
    'callout',
    subject.kind === 'report' ? 'report' : '',
    moving ? 'moving' : '',
    sized ? 'sized' : '',
    front ? 'front' : '',
  ]

  return (
    <section
      className={className.filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      ref={panel}
      style={{ ...style, zIndex: rank }}
      onPointerDownCapture={() => {
        detail.raise(key)
      }}
    >
      <TitleBar {...{ title, subtitle, titleId, onClose, drag }} />
      <div className="callout-body">{children}</div>
      {/* The pointer's hold, as the title bar is: the window keeps its size for the keyboard. */}
      <div className="resize" title="Redimensionner la fenêtre" aria-hidden="true" {...resize} />
    </section>
  )
}

/** The window's name, what it is under it, and the cross. Held, it moves the window. */
function TitleBar({
  title,
  subtitle,
  titleId,
  onClose,
  drag,
}: {
  title: string
  subtitle: string | undefined
  titleId: string
  onClose: () => void
  drag: Drag
}) {
  return (
    <header {...drag} title="Déplacer la fenêtre">
      <div>
        <h3 id={titleId}>{title}</h3>
        <p className="family">{subtitle}</p>
      </div>
      <button
        type="button"
        className="close"
        title="Fermer la fenêtre"
        aria-label="Fermer la fenêtre"
        onClick={onClose}
      />
    </header>
  )
}

/**
 * Closes the window on Escape when it is the one in front, wherever the focus
 * is: the next one then comes in front, and the next press closes it.
 */
function useEscape(onClose: () => void, front: boolean): void {
  useEffect(() => {
    if (!front) return
    const onKey = (event: KeyboardEvent) => {
      if (
        escapeCloses(event, event.target instanceof HTMLElement ? targetOf(event.target) : null)
      ) {
        onClose()
      }
    }
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
    }
  }, [onClose, front])
}

function targetOf(element: HTMLElement) {
  return {
    tagName: element.tagName,
    type: element instanceof HTMLInputElement ? element.type : undefined,
    isContentEditable: element.isContentEditable,
  }
}
