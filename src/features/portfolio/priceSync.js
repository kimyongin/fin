export function summarizePriceSync(result) {
  if (!result || !Array.isArray(result.synced) || !Array.isArray(result.failed)) {
    throw new Error('가격 동기화 결과를 확인할 수 없습니다.')
  }

  const total = Number.isFinite(result.total_count)
    ? result.total_count
    : result.synced.length + result.failed.length
  const succeeded = result.synced.length
  const failed = result.failed.length

  if (total === 0) {
    return { changed: false, message: '동기화할 시장 가격 종목이 없습니다.', status: 'empty' }
  }

  const failureSummary = result.failed
    .slice(0, 3)
    .map((item) => `${item.ticker}: ${item.error}`)
    .join(' · ')
  const remaining = failed > 3 ? ` 외 ${failed - 3}개` : ''

  if (succeeded === 0) {
    throw new Error(`가격 동기화 실패: ${failureSummary}${remaining}`)
  }

  const updatedRows = result.synced.reduce((sum, item) => sum + (Number(item.rows) || 0), 0)
  const base = `${succeeded}/${total}개 종목 확인, 새 가격 ${updatedRows}건 저장`
  if (failed > 0 || result.run_error) {
    const runWarning = result.run_error ? ` 동기화 이력 저장 실패: ${result.run_error}` : ''
    return {
      changed: updatedRows > 0,
      message: failed > 0
        ? `${base}. 실패 ${failed}개 — ${failureSummary}${remaining}.${runWarning}`.trim()
        : `${base}.${runWarning}`.trim(),
      status: 'partial',
    }
  }

  return {
    changed: updatedRows > 0,
    message: `${base}.`,
    status: 'success',
  }
}
