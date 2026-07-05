export function createViewerProfileDraft(profile = null) {
  return {
    public_name: profile?.public_name ?? '',
    sharing_enabled: Boolean(profile?.sharing_enabled),
    viewer_password: '',
    viewer_password_updated_at: profile?.viewer_password_updated_at ?? null,
  }
}

export function createGuestUnlockDraft() {
  return {
    public_name: '',
    viewer_password: '',
  }
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(value)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function isViewerSchemaMissingError(error) {
  const code = error?.code ?? ''
  const message = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`
  const mentionsViewerSchema =
    /profiles/i.test(message) ||
    /viewer_sessions/i.test(message) ||
    /set_viewer_profile/i.test(message) ||
    /unlock_viewer_access/i.test(message) ||
    /get_active_viewer_access/i.test(message)

  return (
    ((code === '42P01' || code === '42883') && mentionsViewerSchema) ||
    ((/schema cache/i.test(message) ||
      /Could not find the table/i.test(message) ||
      /Could not find the function/i.test(message)) &&
      mentionsViewerSchema)
  )
}

export function formatSupabaseError(error, fallback) {
  const message = error?.message ?? fallback
  return error?.code ? `${message} (${error.code})` : message
}

export async function formatFunctionInvokeError(error, fallback) {
  const response = error?.context
  if (response && typeof response.text === 'function') {
    try {
      const rawBody = await response.text()
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody)
          if (parsed?.error) return parsed.error
          if (parsed?.message) return parsed.message
        } catch {
          return rawBody
        }
      }
    } catch {
      // ignore parse failures and fall back below
    }
  }

  return formatSupabaseError(error, fallback)
}
