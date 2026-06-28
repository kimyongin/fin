import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=local-config-1'

function hasSupabaseConfig() {
    try {
        const url = new URL(SUPABASE_URL)
        return url.hostname.endsWith('.supabase.co')
            && !SUPABASE_URL.includes('<project-ref>')
            && !SUPABASE_ANON_KEY.includes('<anon-key>')
    } catch {
        return false
    }
}

export const isSupabaseConfigured = hasSupabaseConfig()
export const supabase = isSupabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

export async function requireAuth() {
    if (!isSupabaseConfigured) {
        if (!location.pathname.endsWith('/login.html')) {
            window.location.href = 'login.html'
        }
        return null
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = 'login.html'
        return null
    }
    return session
}

export async function signOut() {
    if (!supabase) {
        window.location.href = 'login.html'
        return
    }

    await supabase.auth.signOut()
    window.location.href = 'login.html'
}
