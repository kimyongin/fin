import { useEffect, useId, useRef } from 'react'

const modalStack = []
let scrollLockCount = 0
let previousBodyOverflow = ''

function focusableElements(container) {
  return [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

function makeBackgroundInert(overlay) {
  const changed = []
  let current = overlay
  while (current?.parentElement && current.parentElement !== document.body) {
    for (const sibling of current.parentElement.children) {
      if (sibling === current) continue
      changed.push({ element: sibling, inert: sibling.inert })
      sibling.inert = true
    }
    current = current.parentElement
  }
  return () => {
    for (const { element, inert } of changed) element.inert = inert
  }
}

export default function ModalShell({ children, closeDisabled = false, fullScreen = false, initialFocusRef, onClose, title }) {
  const titleId = useId()
  const overlayRef = useRef(null)
  const panelRef = useRef(null)
  const closeButtonRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)
  onCloseRef.current = onClose
  closeDisabledRef.current = closeDisabled

  useEffect(() => {
    const token = Symbol('modal')
    const opener = document.activeElement
    modalStack.push(token)
    const restoreBackground = makeBackgroundInert(overlayRef.current)

    if (scrollLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    scrollLockCount += 1

    const focusTarget = initialFocusRef?.current ?? focusableElements(panelRef.current)[1] ?? closeButtonRef.current
    focusTarget?.focus()

    function handleKeydown(event) {
      if (modalStack.at(-1) !== token) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!closeDisabledRef.current) onCloseRef.current('escape')
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements(panelRef.current)
      if (focusable.length === 0) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeydown, true)
    return () => {
      document.removeEventListener('keydown', handleKeydown, true)
      const index = modalStack.lastIndexOf(token)
      if (index >= 0) modalStack.splice(index, 1)
      restoreBackground()
      scrollLockCount = Math.max(0, scrollLockCount - 1)
      if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [initialFocusRef])

  return (
    <div className={`fixed inset-0 z-[70] bg-[rgba(13,14,18,0.96)] ${fullScreen ? '' : 'px-3 py-3 sm:bg-[rgba(71,49,28,0.18)] sm:px-6 sm:py-8 sm:backdrop-blur-sm'}`} ref={overlayRef}>
      <div className={`mx-auto flex h-full w-full min-w-0 items-start justify-center ${fullScreen ? 'max-w-none' : 'max-w-2xl sm:h-auto'}`}>
        <section aria-labelledby={titleId} aria-modal="true" className={`flex h-full w-full min-w-0 flex-col overflow-hidden bg-[var(--panel)] outline-none ${fullScreen ? '' : 'sm:h-auto sm:max-h-[calc(100vh-4rem)] sm:rounded-[30px] sm:border sm:border-[var(--line)] sm:shadow-[0_30px_70px_rgba(0,0,0,0.45)]'}`} ref={panelRef} role="dialog" tabIndex={-1}>
          <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] bg-[var(--panel)] px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:border-b-0 sm:px-6 sm:pb-0 sm:pt-6">
            <h2 className="pt-1 text-xl font-semibold" id={titleId}>{title}</h2>
            <button
              aria-label="닫기"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-ink)] transition hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={closeDisabled}
              onClick={() => onClose('button')}
              ref={closeButtonRef}
              type="button"
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:max-h-[calc(100vh-10rem)] sm:flex-none sm:px-6 sm:pb-5 sm:pt-5">
            {children}
          </div>
        </section>
      </div>
    </div>
  )
}
