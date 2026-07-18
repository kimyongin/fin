function EntityTitle({ as: Tag = 'h2', children }) {
  return <Tag className="text-base font-semibold leading-6 text-[var(--ink)]">{children}</Tag>
}

export function AccountIdentity({ account, as, detail }) {
  const description = detail ?? [account.broker || '증권사 없음', account.count != null ? `${account.count}개 보유` : null].filter(Boolean).join(' · ')
  return (
    <div className="min-w-0">
      <EntityTitle as={as}>{account.name || '이름 없는 계좌'}</EntityTitle>
      {description && <p className="mt-1 truncate text-sm text-[var(--muted-ink)]">{description}</p>}
      {account.note && <p className="mt-2 line-clamp-2 text-sm text-[var(--muted-ink)]">{account.note}</p>}
    </div>
  )
}

export function InstrumentIdentity({ instrument, as, detail }) {
  const description = detail ?? [instrument.ticker, instrument.currency].filter(Boolean).join(' · ')
  return (
    <div className="min-w-0">
      <EntityTitle as={as}>{instrument.display_name || instrument.ticker || '이름 없는 종목'}</EntityTitle>
      {description && <p className="mt-1 truncate text-sm text-[var(--muted-ink)]">{description}</p>}
      {instrument.note && <p className="mt-2 line-clamp-2 text-sm text-[var(--muted-ink)]">{instrument.note}</p>}
    </div>
  )
}
