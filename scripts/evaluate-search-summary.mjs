// #175 model gate. Synthetic inputs only; no DB, source records, or vector writes.
// Run: node scripts/evaluate-search-summary.mjs
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env.PINECONE_API_KEY && existsSync('.env.search')) process.loadEnvFile('.env.search')
const key = process.env.PINECONE_API_KEY
if (!key) throw new Error('Configure PINECONE_API_KEY in ignored .env.search; never paste it into chat')
const model = 'llama-text-embed-v2'
const dimension = 1024
const headers = { 'Api-Key': key, 'X-Pinecone-Api-Version': '2025-10', 'Content-Type': 'application/json' }
const report = { model, dimension, checked_at: new Date().toISOString(), requests: 0, tokens: 0,
  account_free_plan_verified: false, scope: 'Synthetic input/quality gate; does not enable search', lengths: [] }

async function request(path, body) {
  // No automatic retries: do not loop on exhausted monthly quota or input errors.
  const response = await fetch(`https://api.pinecone.io${path}`, {
    method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  })
  report.requests += 1
  if (!response.ok) throw new Error(`Pinecone HTTP ${response.status}; response body omitted`)
  return response.json()
}

async function embed(text, inputType) {
  if (report.requests >= 40 || report.tokens >= 20000) throw new Error('Synthetic probe budget reached')
  const result = await request('/embed', { model, inputs: [{ text }],
    parameters: { input_type: inputType, truncate: 'NONE', dimension } })
  const vector = result.data?.[0]?.values
  if (result.model !== model || result.vector_type !== 'dense' || result.data?.length !== 1 ||
      !Array.isArray(vector) || vector.length !== dimension ||
      vector.some((x) => !Number.isFinite(x)) || vector.every((x) => x === 0)) {
    throw new Error('Provider model/dimension/vector contract mismatch')
  }
  const tokens = Number(result.usage?.total_tokens)
  if (!Number.isFinite(tokens) || tokens <= 0) throw new Error('Provider did not report token usage')
  report.tokens += tokens
  return { vector, tokens }
}

const fill = (text, count) => Array.from(text.repeat(count)).slice(0, count).join('')
const documents = [
  ['cash-plan', '대출 만기 전 현금 확보 점검', '상환에 필요한 현금과 계좌별 잔액을 확인한다. 재원이 부족하면 매도 필요성과 근거를 기록한다.'],
  ['cash-result', '대출 조건 미확정으로 추가 매수 보류', '상환 일정이 확정되지 않아 장기채 추가 매수를 보류했다. 조건 확정 후 현금 여력을 다시 확인한다.'],
  ['cash-opposite', '상환 재원 확보 후 장기채 추가 매수', '대출 상환에 필요한 현금을 확보하고 장기채를 추가 매수했다. 대출 조건이 바뀌면 현금 여력을 다시 확인한다.'],
  ['dividend', '특별 배당 종료와 정기 배당 유지', '분배금 감소는 특별 배당 종료 때문이다. 정기 배당 삭감으로 판단하지 않았고 생활비 계획을 유지했다.'],
  ['holdings', '두 계좌의 동일 종목 수량 대조', '증권사별 보유 수량을 확인하고 전체 수량을 합산한다. 앱과 다른 계좌만 현재 보유를 보정한다.'],
  ['bias', '급락장에서 손실 회피 편향 점검', '가격 하락에 대한 불안과 매도 판단을 구분한다. 장기 사업 가정과 반대 근거를 확인하고 자동 매도를 피한다.'],
]
const calibration = [
  ['대출 갚을 돈이 있는지 확인하는 작업', ['cash-plan']],
  ['분배금이 줄었는데 생활비 계획을 유지한 이유', ['dividend']],
  ['하락장에서 겁이 나서 팔고 싶을 때 참고할 글', ['bias']],
]
const calibrationUnrelated = ['고양이 털 관리 방법', '주말 등산 준비물', '휴대폰 화면 밝기 조절']
const evaluation = [
  ['대출 불확실성 때문에 투자를 미룬 기록', ['cash-result']],
  ['상환할 현금을 마련하고 채권을 더 산 기록', ['cash-opposite']],
  ['대출과 채권 매수를 함께 검토한 찬반 기록', ['cash-result', 'cash-opposite']],
  ['두 증권사의 같은 주식을 모두 합쳐 확인하는 방법', ['holdings']],
  ['일회성 분배가 끝났지만 정기 소득은 유지된 사례', ['dividend']],
]
const unrelated = ['운동화 세탁 방법', '가을 정원에 심기 좋은 꽃', '가족 사진 액자 고르기']
function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2 }
  return dot / Math.sqrt(aa * bb)
}

let passed = false
try {
  const metadata = await request(`/models/${model}`)
  report.metadata = metadata
  if (metadata.model !== model || metadata.type !== 'embed' || metadata.vector_type !== 'dense' ||
      Number(metadata.max_sequence_length) < 2048 ||
      !(metadata.supported_dimensions ?? [metadata.default_dimension]).includes(dimension)) {
    throw new Error('Model metadata does not satisfy the planned single-input contract')
  }
  for (const [label, pattern] of [
    ['korean', '대출 상환 현금을 확보하기 전에는 추가 매수를 보류한다. '],
    ['mixed', 'TLT 미국채 금리 4.25% USD/KRW 확인 '],
    ['url', 'https://example.com/research?asset=TLT&date=20261001#risk'],
    ['emoji', '😀🚀🧑🏽‍💻👨‍👩‍👧‍👦'],
    ['rare-hangul', '힣뛟쀍꿹쒥'], ['symbols', '∑→±∞≠≤≥※§™'],
    ['normalization-expansion', '\uFDFA'],
  ]) {
    const text = `${fill(pattern, 100)}\n${fill(pattern, 300)}`
    const { tokens } = await embed(text, 'passage')
    report.lengths.push({ label, title_codepoints: 100, summary_codepoints: 300,
      utf8_bytes: Buffer.byteLength(text), tokens })
  }
  const vectors = []
  for (const [id, title, summary] of documents) vectors.push({ id, ...(await embed(`${title}\n${summary}`, 'passage')) })
  async function rank(query) {
    const { vector } = await embed(query, 'query')
    return vectors.map((doc) => ({ id: doc.id, score: cosine(doc.vector, vector) }))
      .sort((a, b) => b.score - a.score)
  }
  const positive = []
  for (const [query, ids] of calibration) {
    const rows = await rank(query)
    positive.push(Math.min(...rows.filter((row) => ids.includes(row.id)).map((row) => row.score)))
  }
  const negative = []
  for (const query of calibrationUnrelated) negative.push((await rank(query))[0].score)
  const floor = Math.max(...negative)
  const ceiling = Math.min(...positive)
  report.calibration = { min_relevant: ceiling, max_unrelated: floor }
  if (floor >= ceiling) throw new Error('Calibration does not separate relevant and unrelated inputs')
  const threshold = (floor + ceiling) / 2
  report.proposed_threshold = threshold
  report.evaluation = []
  for (const [query, ids] of evaluation) {
    const rows = await rank(query)
    const accepted = rows.slice(0, 3).filter((row) => row.score >= threshold)
    report.evaluation.push({ query, expected: ids, accepted,
      passed: ids.every((id) => accepted.some((row) => row.id === id)) })
  }
  report.unrelated = []
  for (const query of unrelated) {
    const rows = await rank(query)
    report.unrelated.push({ query, max_score: rows[0].score, passed: rows[0].score < threshold })
  }
  passed = report.evaluation.every((row) => row.passed) && report.unrelated.every((row) => row.passed)
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Probe failed'
} finally {
  report.passed = passed
  const path = join(tmpdir(), `fin-175-provider-probe-${Date.now()}.json`)
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8' })
  console.log(JSON.stringify({ path, passed, requests: report.requests, tokens: report.tokens,
    error: report.error ?? null }))
}
if (!passed) process.exitCode = 1
