import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

function hasSupabaseConfig() {
  try {
    const url = new URL(SUPABASE_URL)
    const isHostedProject = url.hostname.endsWith('.supabase.co')
    const isLocalProject = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    return (
      (isHostedProject || isLocalProject) &&
      !SUPABASE_URL.includes('<project-ref>') &&
      !SUPABASE_ANON_KEY.includes('<anon-key>') &&
      SUPABASE_ANON_KEY.length > 0
    )
  } catch {
    return false
  }
}

export const isSupabaseConfigured = hasSupabaseConfig()
export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null
