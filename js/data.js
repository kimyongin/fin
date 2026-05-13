import { supabase, requireAuth, signOut } from './supabase.js'

const session = await requireAuth()
if (!session) throw new Error('unauthenticated')

document.getElementById('logout-btn').addEventListener('click', signOut)

document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'))
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'))
        btn.classList.add('active')
        document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden')
    })
})

// TODO: Issue #4 — Instrument + FX Rate + Tag CRUD
// TODO: Issue #5 — 수동 가격 보완
