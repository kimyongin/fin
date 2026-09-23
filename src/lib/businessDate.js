export const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Seoul'

export function businessDate(value = Date.now(), timeZone = DEFAULT_BUSINESS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

// Date-only activity input keeps the existing noon-in-Seoul convention.
export function activityNoon(date) {
  return `${date}T12:00:00+09:00`
}
