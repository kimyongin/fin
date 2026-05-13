import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// 보호 라우트에서 호출. 미인증 시 login.html로 리다이렉트 후 null 반환.
export async function requireAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = 'login.html'
        return null
    }
    return session
}

export async function signOut() {
    await supabase.auth.signOut()
    window.location.href = 'login.html'
}
