import { useCallback, useState } from 'react'

function serializeRow(row) {
  return {
    account_name: row.account_name.trim(),
    broker: row.broker.trim(),
    ticker: row.ticker.trim().toUpperCase(),
    display_name: row.display_name.trim(),
    currency: row.currency,
    instrument_type: row.instrument_type,
    quantity: row.quantity === '' ? null : Number(row.quantity),
    avg_price: row.avg_price === '' ? null : Number(row.avg_price),
    purchase_amount: row.purchase_amount === '' ? null : Number(row.purchase_amount),
    valuation_amount: row.valuation_amount === '' ? null : Number(row.valuation_amount),
    tag_id: row.tag_id || null,
  }
}

export function useSpreadsheetSave({ canEdit, refreshState, supabase }) {
  const [saving, setSaving] = useState(false)
  const save = useCallback(async (rows) => {
    if (!canEdit) throw new Error('읽기 전용 포트폴리오에서는 수정할 수 없습니다.')
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('app_bulk_save_portfolio_rows', {
        input_rows: rows.map(serializeRow),
      })
      if (error) throw error
      await refreshState()
      return Array.isArray(data) ? data[0] : data
    } finally {
      setSaving(false)
    }
  }, [canEdit, refreshState, supabase])

  return { save, saving }
}
