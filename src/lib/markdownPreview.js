export function markdownPreview(value) {
  return String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '코드')
    .replace(/<[^>]+>/g, '')
    .replace(/(^|\n)\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/g, '$1')
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
