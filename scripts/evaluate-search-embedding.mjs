// Synthetic quality probe for the selected passage/query contract. Never reads portfolio content.
const key = process.env.PINECONE_API_KEY
if (!key) throw new Error('PINECONE_API_KEY is required')

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
  '손실률이 일정 수준을 넘더라도 사업의 장기 가정이 유지되면 자동 매도하지 않는다.',
  '영업현금흐름이 흑자여도 일회성 자산 매각 수익은 지속 이익으로 보지 않는다.',
  '분기 배당이 줄었지만 특별 배당 종료 때문인지 정기 배당 삭감인지 구분한다.',
  '환율이 높을 때 달러 자산을 매수하면 원화 환산 손익 변동이 커질 수 있다.',
  '기준금리 인하가 예상되어도 장기 채권은 물가 상승 위험을 따로 살핀다.',
  '동일 종목을 두 계좌에 보유하면 계좌별 수량과 전체 수량을 모두 확인한다.',
  '목표 비중에서 5퍼센트포인트 이상 벗어난 자산만 다음 점검의 조정 후보로 표시한다.',
  '실적 성장률이 높아도 주식보상 비용이 늘면 주당 이익 증가와 다를 수 있다.',
  '가격이 급락했을 때 매수 근거가 훼손되었다면 추가 매수를 보류한다.',
  '종목과 무관한 일반 할 일은 완료했어도 과거 기록 검색에 남긴다.',
  '공유받은 사용자는 활동을 읽을 수 있지만 소유자의 기록을 수정할 수 없다.',
  '검색 점수가 높아도 기록의 판단이 현재 원칙과 충돌하면 반대 근거로 검토한다.',
  '소제목: 급락장 예외. 현금이 부족한 상황에서는 목표 비중보다 생활비 확보를 우선한다.',
  '소제목: 환율 조건. 달러 자산의 수익률이 양수여도 원화 강세로 평가액이 줄 수 있다.',
  '소제목: 배당 예외. 이사회가 특별 배당만 종료했다면 정기 현금흐름 감소와 구분한다.',
  '소제목: 채권 위험. 금리 인하가 예상되어도 신용위험이 높아진 채권은 따로 제외한다.',
  '소제목: 기록 수정. 본문 뒷부분만 고치면 예전 검색 벡터가 남지 않게 다시 색인한다.',
  '소제목: 시장 종목. 보유하지 않은 종목도 티커를 연결해 기록할 수 있다.',
]
const groups = [
  { name: 'topic', cases: [
    ['하락장에 마음이 흔들릴 때 참고할 자료',0], ['편향을 점검하는 투자 글',7],
    ['자산군을 다시 맞추는 원칙',3], ['단기 성과보다 투자 기간을 보라는 내용',9] ] },
  { name: 'detail', cases: [
    ['실적이 좋아 보여도 일회성 수익을 빼야 하는 이유',13],
    ['특별 배당 종료와 정기 배당 삭감의 차이',14],
    ['전체 포트폴리오의 종목 수량을 어떻게 계산하나',17],
    ['목표에서 얼마나 벗어나야 조정 후보인가',18] ] },
  { name: 'exception', cases: [
    ['손실이 커도 무조건 매도하지 않는 조건',12],
    ['급락 시 추가 매수를 멈춰야 하는 경우',20],
    ['점수가 높아도 현재 원칙과 맞지 않는 기록은 어떻게 볼까',23],
    ['주당 이익과 매출 성장률이 어긋나는 이유',19] ] },
  { name: 'mixed', cases: [
    ['달러 자산 가치에 환율이 미치는 영향',4],
    ['계좌가 둘일 때 같은 주식 비중 확인',6],
    ['채권 가격과 금리 상승의 관계',8],
    ['매수한 적 없는 시장 종목에 티커를 남길 수 있나',29] ] },
  { name: 'boundary', cases: [
    ['생활비가 부족한 급락장에서 먼저 챙길 것',24],
    ['금리를 내려도 신용 위험이 큰 채권을 피하는 규칙',27],
    ['원화 강세가 달러 투자 수익을 상쇄할 수 있나',25],
    ['완료한 일반 작업도 예전 자료에서 찾을 수 있나',21] ] },
  { name: 'late', cases: [
    ['수정한 글의 뒤쪽 정보는 어떻게 다시 색인하나',28],
    ['특별 배당만 끝나면 정기 소득에는 무슨 영향이 있나',26],
    ['중요한 매도 예외가 글 뒤에 있을 때 찾는 법',12],
    ['보유가 없어도 종목 기록을 연결할 수 있는지',29] ] },
]
const calibrationUnrelated = [
  '오늘 저녁에 먹을 음식 추천', '고양이 털 관리 방법', '비밀번호를 바꾸는 절차',
]
const unrelated = [
  '주말 등산 준비물', '휴대폰 화면 밝기 조절', '운동화 세탁 방법',
  '가을 정원에 심기 좋은 꽃', '가족 사진 액자 고르기', '우산이 고장났을 때 수리법',
]
const calibration = [
  ['시장이 떨어져 겁이 날 때 무엇을 참고하지?',0],
  ['분배금 감소가 생활비 계획에 미치는 영향',1],
  ['기업의 수익성은 어디서 확인할까?',2],
  ['자산군 비율을 다시 맞추는 방법',3],
  ['달러가 오르면 내 자산가치가 어떻게 달라지나?',4],
  ['계좌의 주식 수와 기록이 맞지 않는다',5],
  ['두 증권사에 나뉜 같은 주식의 비율',6],
  ['내 생각과 다른 증거도 찾아봐야 할까?',7],
  ['기준금리가 오를 때 채권은 어떻게 될까?',8],
  ['최근 손실 때문에 계획을 바꿔야 하나?',9],
  ['가격 정보가 예전 것 같다',10],
  ['나중에 다시 볼 투자 자료를 남기고 싶다',11],
]
let tokens = 0
let requests = 0
async function embed(text, inputType) {
  const started = Date.now()
  const response = await fetch('https://api.pinecone.io/embed', {
    method: 'POST',
    headers: { 'Api-Key': key, 'X-Pinecone-Api-Version': '2025-10', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'multilingual-e5-large', inputs: [{ text }],
      parameters: { input_type: inputType, truncate: 'NONE' } }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Pinecone embedding HTTP ${response.status}`)
  const data = await response.json()
  if (data.model !== 'multilingual-e5-large' || data.vector_type !== 'dense' ||
      data.data?.length !== 1 || data.data[0].values?.length !== 1024) {
    throw new Error('Invalid Pinecone embedding response')
  }
  tokens += Number(data.usage?.total_tokens) || 0
  requests += 1
  return { vector: data.data[0].values, elapsed: Date.now()-started }
}
function cosine(a,b) {
  let dot=0, aa=0, bb=0
  for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; aa+=a[i]*a[i]; bb+=b[i]*b[i] }
  return dot / Math.sqrt(aa*bb)
}
const docVectors=[]
for (const text of documents) docVectors.push((await embed(text,'passage')).vector)
function rank(qv) {
  return docVectors.map((v,index)=>({index,score:cosine(v,qv)}))
    .sort((a,b)=>b.score-a.score || a.index-b.index)
}
const calibrationScores=[]
for (const [query,expected] of calibration) {
  const rows=rank((await embed(query,'query')).vector)
  calibrationScores.push(rows.find(r=>r.index===expected).score)
}
const calibrationUnrelatedScores=[]
for (const query of calibrationUnrelated) calibrationUnrelatedScores.push(rank((await embed(query,'query')).vector)[0].score)
const threshold=Math.min(1,Math.max(...calibrationUnrelatedScores)+0.001)
const unrelatedRows=[]
for (const query of unrelated) unrelatedRows.push(rank((await embed(query,'query')).vector))
let hits=0, rr=0
const failures=[]
for (const group of groups) {
  let groupHits=0
  for (const [caseIndex,[query,expected]] of group.cases.entries()) {
    const rows=rank((await embed(query,'query')).vector)
    const row=rows.find(r=>r.index===expected)
    const hit=rows.slice(0,5).some(r=>r.index===expected && r.score>=threshold)
    if (!hit) failures.push({ group: group.name, case: caseIndex+1,
      rank: rows.findIndex(r=>r.index===expected)+1, score: Number(row.score.toFixed(4)),
      top_document: rows[0].index })
    groupHits+=Number(hit)
    hits+=Number(hit)
    rr+=hit ? 1/(rows.findIndex(r=>r.index===expected)+1) : 0
  }
  process.stdout.write(`${group.name}=${groupHits}/${group.cases.length}\n`)
}
process.stdout.write(`threshold=${threshold.toFixed(4)} calibration_above=${calibrationScores.filter(s=>s>=threshold).length}/12\n`)
process.stdout.write(`hit_at_5=${hits}/24 mrr=${(rr/24).toFixed(3)} unrelated_hits=${unrelatedRows.filter(rows=>rows[0].score>=threshold).length}/6\n`)
process.stdout.write(`failures=${JSON.stringify(failures)}\n`)
process.stdout.write(`unrelated_false_positives=${JSON.stringify(unrelatedRows.flatMap((rows,index)=>
  rows[0].score>=threshold ? [{ case: index+1, score: Number(rows[0].score.toFixed(4)),
    top_document: rows[0].index }] : []))}\n`)
process.stdout.write(`requests=${requests} tokens=${tokens}\n`)
