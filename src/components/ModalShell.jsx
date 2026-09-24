import { useEffect, useId, useRef, useState } from 'react'

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

export default function ModalShell({ children, closeDisabled = false, compact = false, description, dirty = false, footer, fullScreen = false, historyGuardRef, initialFocusRef, onBack, onClose, title, variant = 'modal' }) {
  const titleId = useId()
  const descriptionId = useId()
  const overlayRef = useRef(null)
  const panelRef = useRef(null)
  const closeButtonRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)
  const dirtyRef = useRef(dirty)
  const [confirmingClose, setConfirmingClose] = useState(false)
  onCloseRef.current = onClose
  closeDisabledRef.current = closeDisabled
  dirtyRef.current = dirty
  if (historyGuardRef) historyGuardRef.current = () => {
    if (closeDisabledRef.current) return false
    if (dirtyRef.current) { setConfirmingClose(true); return false }
    return true
  }

  function requestClose(reason) {
    if (closeDisabledRef.current) return
    if (dirtyRef.current) {
      setConfirmingClose(true)
      return
    }
    onCloseRef.current(reason)
  }

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
        if (event.target instanceof Element && event.target.closest('[data-escape-results-open="true"]')) return
        event.preventDefault()
        requestClose('escape')
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
      if (historyGuardRef) historyGuardRef.current = null
      document.removeEventListener('keydown', handleKeydown, true)
      const index = modalStack.lastIndexOf(token)
      if (index >= 0) modalStack.splice(index, 1)
      restoreBackground()
      scrollLockCount = Math.max(0, scrollLockCount - 1)
      if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [initialFocusRef])

  const isDetail = variant === 'detail'
  const isFullHeight = fullScreen || isDetail
  const renderedFooter = typeof footer === 'function'
    ? footer(() => requestClose('footer'))
    : footer

  return (
    <div className={`fixed inset-0 z-[70] bg-[rgba(13,14,18,0.96)] ${isDetail ? 'lg:bg-[rgba(13,14,18,0.72)] lg:backdrop-blur-sm' : fullScreen ? '' : compact ? 'flex items-center px-4 py-4 sm:bg-[rgba(71,49,28,0.18)] sm:backdrop-blur-sm' : 'sm:bg-[rgba(71,49,28,0.18)] sm:px-6 sm:py-8 sm:backdrop-blur-sm'}`} ref={overlayRef}>
      <div className={`flex w-full min-w-0 ${isDetail ? 'h-full justify-end' : compact ? 'mx-auto max-w-lg justify-center' : 'mx-auto h-full items-start justify-center'} ${isFullHeight ? 'max-w-none' : compact ? 'h-auto' : 'max-w-2xl sm:h-auto'}`}>
        <section aria-describedby={description ? descriptionId : undefined} aria-labelledby={titleId} aria-modal="true" className={`flex w-full min-w-0 flex-col overflow-hidden bg-[var(--panel)] outline-none ${isDetail ? 'h-full lg:max-w-[40rem] lg:border-l lg:border-[var(--line)] lg:shadow-[-24px_0_70px_rgba(0,0,0,0.4)]' : fullScreen ? 'h-full' : compact ? 'max-h-[calc(100dvh-2rem)] rounded-[24px] border border-[var(--line)] shadow-[0_30px_70px_rgba(0,0,0,0.45)]' : 'h-full sm:h-auto sm:max-h-[calc(100vh-4rem)] sm:rounded-[30px] sm:border sm:border-[var(--line)] sm:shadow-[0_30px_70px_rgba(0,0,0,0.45)]'}`} ref={panelRef} role="dialog" tabIndex={-1}>
          <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] bg-[var(--panel)] px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:border-b-0 sm:px-6 sm:pb-0 sm:pt-6">
            <div className="flex min-w-0 items-start gap-2">
              {onBack && <button aria-label="이전 기록으로" className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-ink)] transition hover:text-[var(--ink)]" onClick={onBack} type="button">←</button>}
              <div className="min-w-0">
                <h2 className="break-words pt-1 text-xl font-semibold" id={titleId}>{title}</h2>
                {description && <p className="mt-1 text-sm leading-5 text-[var(--muted-ink)]" id={descriptionId}>{description}</p>}
              </div>
            </div>
            <button
              aria-label="닫기"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-ink)] transition hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={closeDisabled}
              onClick={() => requestClose('button')}
              ref={closeButtonRef}
              type="button"
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
              </svg>
            </button>
          </div>
          <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-5 ${isFullHeight ? '' : 'sm:max-h-[calc(100vh-14rem)] sm:flex-none'}`}>
            {children}
          </div>
          {(renderedFooter || confirmingClose) && <div className="border-t border-[var(--line)] bg-[var(--panel)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            {confirmingClose ? (
              <div className="grid gap-3" role="alert">
                <p className="text-sm leading-6 text-[var(--muted-ink)]">저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?</p>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                  <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => setConfirmingClose(false)} type="button">계속 편집</button>
                  <button className="min-h-11 rounded-xl border border-red-400/40 bg-red-500/10 px-4 text-sm font-semibold text-red-100" onClick={() => onCloseRef.current('discard')} type="button">변경 버리기</button>
                </div>
              </div>
            ) : renderedFooter}
          </div>}
        </section>
      </div>
    </div>
  )
}
