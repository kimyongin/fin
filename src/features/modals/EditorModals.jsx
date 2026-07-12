import { useEffect, useRef, useState } from 'react'
import { tagColorOptions } from '../../constants/portfolio'
import ModalActions from '../../components/ModalActions'
import ModalShell from '../../components/ModalShell'
import { formatUnitPrice } from '../../lib/format'
import { normalizeTickerInput } from '../../lib/portfolioMath'

export function AccountEditorModal({
  accountError,
  accountSaving,
  draft,
  onChange,
  onClose,
  onDelete,
  onSave,
}) {
  return (
    <ModalShell onClose={onClose} title={draft.id ? draft.name || '계좌 수정' : '계좌 추가'}>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            계좌명
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('name', event.target.value)}
            value={draft.name}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            증권사
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('broker', event.target.value)}
            value={draft.broker}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            메모
          </span>
          <textarea
            className="min-h-24 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('note', event.target.value)}
            value={draft.note}
          />
        </label>

        {accountError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {accountError}
          </div>
        )}

        <ModalActions
          canDelete={!!draft.id}
          deleteConfirmMessage="계좌를 삭제하면 이 계좌 정보가 사라집니다. 계속할까요?"
          deleteLabel="계좌 삭제"
          disabled={accountSaving}
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
          saveLabel={accountSaving ? '저장 중' : '저장'}
        />
      </div>
    </ModalShell>
  )
}

export function InstrumentEditorModal({
  accounts,
  draft,
  instrumentError,
  instrumentSaving,
  onChange,
  onClose,
  onDelete,
  onSave,
  tags,
}) {
  return (
    <ModalShell onClose={onClose} title={draft.id ? '종목 수정' : '종목 추가'}>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            티커
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-black/30"
            disabled={!!draft.id}
            onChange={(event) => onChange('ticker', event.target.value.trim().toUpperCase())}
            value={draft.ticker}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            종목명
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('display_name', event.target.value)}
            value={draft.display_name}
          />
        </label>

        {!draft.id && (
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              보유 계좌
            </span>
            <select
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('linked_account_id', event.target.value)}
              value={draft.linked_account_id}
            >
              <option value="">계좌 선택 안 함</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              통화
            </span>
            <select
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('currency', event.target.value)}
              value={draft.currency}
            >
              {['KRW', 'USD', 'JPY'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              종류
            </span>
            <select
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('instrument_type', event.target.value)}
              value={draft.instrument_type}
            >
              {['stock', 'etf', 'fund', 'cash', 'other', 'fx'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              현재가
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('price', event.target.value)}
              step="any"
              type="number"
              value={draft.price}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              가격일
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('price_date', event.target.value)}
              type="date"
              value={draft.price_date}
            />
          </label>
        </div>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            대표 태그
          </span>
          <select
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('tag_id', event.target.value)}
            value={draft.tag_id}
          >
            <option value="">태그 없음</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            메모
          </span>
          <textarea
            className="min-h-24 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('note', event.target.value)}
            value={draft.note}
          />
        </label>

        {instrumentError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {instrumentError}
          </div>
        )}

        <ModalActions
          canDelete={!!draft.id}
          deleteConfirmMessage="종목과 연결된 태그, 가격 이력이 함께 삭제됩니다. 계속할까요?"
          deleteLabel="종목 삭제"
          disabled={instrumentSaving}
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
          saveLabel={instrumentSaving ? '저장 중' : '저장'}
        />
      </div>
    </ModalShell>
  )
}

export function HoldingEditorModal({
  accounts,
  draft,
  holdingError,
  holdingLookupError,
  holdingLookupResult,
  holdingLookupSaving,
  holdingSaving,
  instruments,
  onChange,
  onClose,
  onLookupTicker,
  onDelete,
  onSave,
}) {
  const [tickerMenuOpen, setTickerMenuOpen] = useState(false)
  const tickerMenuRef = useRef(null)
  const normalizedDraftTicker = normalizeTickerInput(draft.ticker)
  const selectedInstrument = instruments.find((instrument) => instrument.ticker === normalizedDraftTicker)
  const selectedCurrency =
    holdingLookupResult?.ticker === normalizedDraftTicker
      ? holdingLookupResult.currency
      : selectedInstrument?.currency
  const suggestedInstruments = draft.ticker
    ? instruments
        .filter((instrument) => {
          const query = normalizedDraftTicker
          const ticker = normalizeTickerInput(instrument.ticker)
          const name = normalizeTickerInput(instrument.display_name)
          return ticker.includes(query) || name.includes(query)
        })
        .slice(0, 6)
    : instruments.slice(0, 6)

  useEffect(() => {
    function handleClickOutside(event) {
      if (!tickerMenuRef.current?.contains(event.target)) {
        setTickerMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <ModalShell onClose={onClose} title={draft.id ? '보유 수정' : '보유 종목 추가'}>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            계좌
          </span>
          <select
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('account_id', event.target.value)}
            value={draft.account_id}
          >
            <option value="">계좌 선택</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            티커
          </span>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1" ref={tickerMenuRef}>
              <div
                aria-busy={holdingLookupSaving}
                className={`flex min-w-0 items-center rounded-2xl border bg-[var(--surface-3)] pr-2 transition focus-within:border-[var(--accent)] ${
                  holdingLookupSaving
                    ? 'border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]'
                    : 'border-[var(--line)]'
                }`}
              >
                <input
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 outline-none"
                  disabled={holdingLookupSaving}
                  onChange={(event) => {
                    onChange('ticker', normalizeTickerInput(event.target.value))
                    setTickerMenuOpen(true)
                  }}
                  onFocus={() => setTickerMenuOpen(true)}
                  placeholder="예: AAPL, 360750, JPYKRW=X"
                  value={draft.ticker}
                />
                <button
                  aria-label="티커 목록 열기"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  disabled={holdingLookupSaving}
                  onClick={() => setTickerMenuOpen((current) => !current)}
                  type="button"
                >
                  <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <path
                      d="m6 9 6 6 6-6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                  </svg>
                </button>
              </div>
              {tickerMenuOpen && !!suggestedInstruments.length && (
                <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-[var(--line)] bg-[#1b1d23] shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                  {suggestedInstruments.map((instrument) => (
                    <button
                      className="flex w-full items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-2.5 text-left text-sm transition hover:bg-[var(--surface-3)] last:border-b-0"
                      key={instrument.ticker}
                      onClick={() => {
                        onChange('ticker', instrument.ticker)
                        setTickerMenuOpen(false)
                      }}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[var(--ink)]">
                          {instrument.display_name}
                        </span>
                        <span className="block truncate text-[var(--muted-ink)]">
                          {instrument.ticker}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-[var(--muted-ink)]">
                        {instrument.currency}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-[var(--line)] px-3 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-70 sm:min-w-20 sm:w-auto"
              disabled={holdingSaving || holdingLookupSaving}
              onClick={onLookupTicker}
              type="button"
            >
              {holdingLookupSaving && (
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]"
                />
              )}
              {holdingLookupSaving ? '조회 중' : '조회'}
            </button>
          </div>
          {holdingLookupSaving && (
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted-ink)]">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]"
              />
              <span>티커 정보를 확인하고 있습니다. 잠시만 기다려 주세요.</span>
            </div>
          )}
        </div>

        {!holdingLookupSaving && holdingLookupResult && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-[var(--ink)]">
                {holdingLookupResult.display_name}
              </span>
              <span className="text-[var(--muted-ink)]">{holdingLookupResult.ticker}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted-ink)]">
              <span>통화 {holdingLookupResult.currency}</span>
              <span>종류 {holdingLookupResult.instrument_type}</span>
              {Number.isFinite(holdingLookupResult.price) && (
                <span>
                  현재가{' '}
                  {formatUnitPrice(holdingLookupResult.price, holdingLookupResult.currency)}
                </span>
              )}
            </div>
          </div>
        )}

        {holdingLookupError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {holdingLookupError}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              수량
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('quantity', event.target.value)}
              step="any"
              type="number"
              value={draft.quantity}
            />
          </label>

          <label className="grid gap-2">
            <span className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              <span>평균 단가</span>
              {selectedCurrency && (
                <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] tracking-normal text-[var(--ink)]">
                  {selectedCurrency}
                </span>
              )}
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('avg_price', event.target.value)}
              step="any"
              type="number"
              value={draft.avg_price}
            />
          </label>
        </div>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            메모
          </span>
          <textarea
            className="min-h-24 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('note', event.target.value)}
            value={draft.note}
          />
        </label>

        {holdingError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {holdingError}
          </div>
        )}

        <ModalActions
          canDelete={!!draft.id}
          deleteConfirmMessage="이 계좌의 보유 항목을 삭제합니다. 계속할까요?"
          deleteLabel="보유 삭제"
          disabled={holdingSaving}
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
          saveLabel={holdingSaving ? '저장 중' : '저장'}
        />
      </div>
    </ModalShell>
  )
}

export function TagEditorModal({ draft, onChange, onClose, onSave, tagError, tagSaving }) {
  return (
    <ModalShell onClose={onClose} title={draft.id ? '태그 수정' : '태그 추가'}>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            태그명
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('name', event.target.value)}
            value={draft.name}
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              색상
            </span>
            <select
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('color', event.target.value)}
              value={draft.color}
            >
              {tagColorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              정렬 순서
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('sort_order', event.target.value)}
              type="number"
              value={draft.sort_order}
            />
          </label>
        </div>

        {tagError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {tagError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={tagSaving}
            onClick={onClose}
            type="button"
          >
            닫기
          </button>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={tagSaving}
            onClick={onSave}
            type="button"
          >
            {tagSaving ? '저장 중' : '저장'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
