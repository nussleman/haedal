# supabase/

DB 구조 변경과 Edge Function 소스를 저장소에서 추적한다.

- `migrations/` — 이 날짜 이후 적용한 스키마 변경 (그 이전 테이블은 아직 기록 전, 3단계에서 전체 스키마를 덤프해 채울 예정)
- `functions/index-refresh/` — S&P500 월말 종가를 `index_prices`에 채움. 대시보드가 지난달 값이 없을 때 호출
