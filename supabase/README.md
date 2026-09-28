# supabase/

해달 DB(`rjxmrpifrhybucexuvli`)의 구조를 저장소에서 추적한다.

## schema/ — 전체 구조 스냅샷 (2026-09-28)

`public` 스키마의 테이블 59개·제약·인덱스·함수·뷰·트리거·RLS 정책 전부.
새 Supabase 프로젝트에 번호 순서대로 실행하면 같은 구조가 만들어진다 (데이터는 없음).

```
00_sequences → 01_pre_functions → 02_tables → 03_constraints → 04_indexes
→ 05_functions → 06_views → 07_triggers → 08_rls → 09_policies
```

- 이 DB 에는 해달 외에 브레인덤프·미디어·라이프 기록 앱의 테이블도 함께 있다.
- `verify.sql` 을 돌려 나온 값이 `expected.md5` 와 같으면 스냅샷 = 실제 DB.
- 판매용 새 DB 를 만들 때는 `05_functions.sql` 의 데이트 통장 이메일(date_couple_emails, date_is_editor)을 바꿔야 한다.

## migrations/ — 스냅샷 이후 변경

DB 를 바꿀 때마다 `YYYYMMDDHHMMSS_설명.sql` 로 남긴다. 스냅샷을 다시 뜨면 그 이전 파일은 참고용이 된다.

## functions/ — Edge Function 소스

- `index-refresh` — S&P500 월말 종가를 `index_prices` 에 채움. 대시보드가 지난달 값이 없을 때 호출
