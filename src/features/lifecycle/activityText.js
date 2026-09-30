export function activityUpperTextError(title, summary, original = {}) {
  for (const [field, value, limit, label] of [
    ['title', title, 100, '제목'], ['summary', summary, 300, '요약'],
  ]) {
    const text = (value ?? '').trim()
    if (!text) return `${label}을 작성해 주세요.`
    if (text !== original[field]?.trim() && Array.from(text).length > limit) {
      return `${label}은 ${limit}자 이내로 작성해 주세요. 현재 ${Array.from(text).length}자입니다.`
    }
  }
  return ''
}
