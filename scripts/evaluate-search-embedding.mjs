// Manual quality probe for the currently configured local Edge embedding model.
// Uses only synthetic text and prints ranks, never portfolio content or credentials.
const endpoint = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!endpoint || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')

const documents = [
  '급락장에서 불안해서 팔고 싶을 때 손실 회피 편향을 점검한다.',
  '배당금이 줄어들면 현금흐름 계획을 다시 계산한다.',
  '실적 발표 후 매출 증가와 이익률을 비교한다.',
  '주식과 채권의 목표 비중을 검토하고 편차가 크면 리밸런싱한다.',
  '원화 가치가 변하면 달러 자산의 환산 평가액도 변한다.',
  '증권사 잔고 수량과 앱의 수량이 다르면 현재 보유를 보정한다.',
  '같은 종목을 여러 계좌에 보유하면 전체 비중을 합쳐 본다.',
  '투자 판단을 하기 전에 반대 근거와 확증 편향을 살펴본다.',
  '금리 인상은 채권 가격과 기업의 자금 조달 비용에 영향을 준다.',
  '단기 수익률에 흔들리지 말고 원칙과 투자 기간을 확인한다.',
  '종목의 현재가를 갱신하고 오래된 시세를 구분한다.',
  '새로운 투자 아이디어는 관련 자료를 기록하고 추후 다시 읽는다.',
]
const questions = [
  ['시장이 떨어져 겁이 날 때 무엇을 참고하지?', 0],
  ['분배금 감소가 생활비 계획에 미치는 영향', 1],
  ['기업의 수익성은 어디서 확인할까?', 2],
  ['자산군 비율을 다시 맞추는 방법', 3],
  ['달러가 오르면 내 자산가치가 어떻게 달라지나?', 4],
  ['계좌의 주식 수와 기록이 맞지 않는다', 5],
  ['두 증권사에 나뉜 같은 주식의 비율', 6],
  ['내 생각과 다른 증거도 찾아봐야 할까?', 7],
  ['기준금리가 오를 때 채권은 어떻게 될까?', 8],
  ['최근 손실 때문에 계획을 바꿔야 하나?', 9],
  ['가격 정보가 예전 것 같다', 10],
  ['나중에 다시 볼 투자 자료를 남기고 싶다', 11],
]

async function embed(text) {
  const response = await fetch(`${endpoint}/functions/v1/activity-search-index`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'query', query: text }),
  })
  if (!response.ok) throw new Error(`Embedding request failed: ${response.status}`)
  const result = await response.json()
  return result.embedding
}

const documentVectors = []
for (const document of documents) documentVectors.push(await embed(document))
let topFive = 0
let aboveThreshold = 0
for (const [query, expected] of questions) {
  const queryVector = await embed(query)
  const scores = documentVectors.map((vector, index) => ({
    index,
    similarity: vector.reduce((sum, value, dimension) => sum + value * queryVector[dimension], 0),
  })).sort((a, b) => b.similarity - a.similarity)
  const rank = scores.findIndex(({ index }) => index === expected) + 1
  const similarity = scores[rank - 1].similarity
  if (rank <= 5) topFive += 1
  if (similarity >= 0.96) aboveThreshold += 1
  process.stdout.write(`expected=${expected + 1} rank=${rank} similarity=${similarity.toFixed(3)} top=${scores[0].index + 1}\n`)
}
for (const query of ['오늘 저녁에 먹을 음식 추천', '고양이 털 관리 방법', '비밀번호를 바꾸는 절차']) {
  const queryVector = await embed(query)
  const highest = Math.max(...documentVectors.map((vector) =>
    vector.reduce((sum, value, dimension) => sum + value * queryVector[dimension], 0)))
  process.stdout.write(`unrelated_top_similarity=${highest.toFixed(3)}\n`)
}
process.stdout.write(`top5=${topFive}/${questions.length} threshold_0.96=${aboveThreshold}/${questions.length}\n`)
