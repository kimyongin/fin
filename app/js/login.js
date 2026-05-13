import { supabase } from './supabase.js'

const form = document.getElementById('login-form')
const emailInput = document.getElementById('email')
const checkBtn = document.getElementById('check-session')
const message = document.getElementById('message')

function showMessage(text, type = 'success') {
    message.textContent = text
    message.className = `message ${type}`
    message.classList.remove('hidden')
}

form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = emailInput.value.trim()
    if (!email) return

    const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback.html` },
    })

    if (error) {
        showMessage(error.message, 'error')
    } else {
        showMessage('로그인 링크를 보냈습니다. 이메일을 확인하세요.')
    }
})

checkBtn.addEventListener('click', async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
        window.location.href = 'index.html'
    } else {
        showMessage('아직 로그인이 확인되지 않았습니다. 이메일의 링크를 클릭하세요.', 'error')
    }
})
