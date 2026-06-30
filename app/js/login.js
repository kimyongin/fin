import { supabase, isSupabaseConfigured } from './supabase.js'

const form = document.getElementById('login-form')
const emailInput = document.getElementById('email')
const checkBtn = document.getElementById('check-session')
const googleBtn = document.getElementById('google-login')
const message = document.getElementById('message')

function showMessage(text, type = 'success') {
    message.textContent = text
    message.className = `message ${type}`
    message.classList.remove('hidden')
}

if (!isSupabaseConfigured) {
    showMessage('Supabase 설정이 필요합니다. app/js/config.js의 SUPABASE_URL과 SUPABASE_ANON_KEY를 실제 값으로 바꿔주세요.', 'error')
    form.querySelector('button[type="submit"]').disabled = true
    googleBtn.disabled = true
    checkBtn.disabled = true
} else {
    form.addEventListener('submit', async (e) => {
        e.preventDefault()
        const email = emailInput.value.trim()
        if (!email) return

        const base = location.origin + location.pathname.replace(/\/[^/]*$/, '')
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: `${base}/auth/callback.html` },
        })

        if (error) {
            showMessage(error.message, 'error')
        } else {
            showMessage('로그인 링크를 보냈습니다. 이메일을 확인하세요.')
        }
    })

    googleBtn.addEventListener('click', async () => {
        const base = location.origin + location.pathname.replace(/\/[^/]*$/, '')
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${base}/auth/callback.html` },
        })
        if (error) showMessage(error.message, 'error')
    })

    checkBtn.addEventListener('click', async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
            window.location.href = 'index.html'
        } else {
            showMessage('아직 로그인이 확인되지 않았습니다. 이메일의 링크를 클릭하세요.', 'error')
        }
    })
}
