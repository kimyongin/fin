# 리포트/리밸런싱 본문은 DB가 아닌 Supabase Storage에 저장

`daily_reports`와 `rebalance_suggestions`의 전문 본문(.md)을 DB TEXT 컬럼이 아니라 Supabase Storage `reports` 버킷에 저장한다. DB에는 경로(`storage_path`)만 남긴다.

## 이유

Supabase Free 플랜 DB 한도(500MB)를 보호하기 위해서다. Storage는 Free 1GB이고 마크다운 텍스트는 공간을 거의 차지하지 않는다. DB에는 카드 UI에 필요한 요약(headline, indicators, trade_suggestions 등)만 저장하고, 전문은 signed URL로 필요할 때만 읽는다.

## 주의

`storage_path`가 없는 행은 본문이 없는 것이지 버그가 아니다(Storage 업로드 실패 시 `null`로 저장). Web App에서 본문을 읽을 때는 `storage.from('reports').createSignedUrl(storage_path, 60)`을 사용한다.
