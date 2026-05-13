import { supabase, requireAuth, signOut } from './supabase.js'

const session = await requireAuth()
if (!session) throw new Error('unauthenticated')

document.getElementById('logout-btn').addEventListener('click', signOut)

// 탭 전환
document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'))
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'))
        btn.classList.add('active')
        document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden')
    })
})

// TODO: Issue #7 — 자산 hero + Position 목록
// TODO: Issue #6 — 계좌 + 거래 CRUD
// TODO: Issue #8 — 태그 필터 + 구성 차트 + 타임라인 차트
