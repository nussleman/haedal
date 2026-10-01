# supabase/

해달 DB(`rjxmrpifrhybucexuvli`)의 구조를 저장소에서 추적한다.

## schema/ — 전체 구조 스냅샷 (2026-09-28, 토스·종목 팩트 이전 후)

`public` 스키마의 테이블 48개·제약·인덱스·함수·뷰·트리거·RLS 정책 전부. (+ `private.ingest_keys`)
새 Supabase 프로젝트에 번호 순서대로 실행하면 같은 구조가 만들어진다 (데이터는 없음).

```
00_sequences → 01_pre_functions → 02_tables → 03_constraints → 04_indexes
→ 05_functions → 06_views → 07_triggers → 08_rls → 09_policies
```

- 이 DB 는 코알라 앱(nussleman/koala — 목표·브레인덤프·콘텐츠·그림·커리어)과 함께 쓴다. 테이블을 지우기 전에 두 저장소를 모두 확인할 것.
- `verify.sql` 을 돌려 나온 값이 `expected.md5` 와 같으면 스냅샷 = 실제 DB.
- 구조만 담는다(데이터·권한 부여 GRANT 제외). 개인 정보는 들어 있지 않다.
- 토스 수집기(`collector/`)는 `toss_ingest(비밀값, 요약, 보유종목)` 한 함수만 부른다. 비밀값의 해시는 `private.ingest_keys` 에 있고 API 로는 보이지 않는다.
- 말랑한 통장(예전 이름 데이트 통장, 테이블 이름은 date_*)은 `date_books` 한 줄에 `allowed_emails`(들어올 사람) · `editor_emails`(고칠 사람) · `people`(입금자 이름)을 넣어야 쓸 수 있다.
- 같은 줄의 `link_owner`(해달 사용자) · `link_merchant`(해달 사용처 이름) · `link_depositor`(입금자 이름)을 채우면, 해달 입출금 내역에서 그 사용처로 적은 기록이 트리거(`date_sync_from_haedal`)로 통장 기록에 자동으로 들어간다 (`date_tx.haedal_tx_id` 로 연결).

## migrations/ — 스냅샷 이후 변경

DB 를 바꿀 때마다 `YYYYMMDDHHMMSS_설명.sql` 로 남긴다. 스냅샷을 다시 뜨면 그 이전 파일은 참고용이 된다.

## functions/ — Edge Function 소스

- (없음) 예전 `index-refresh`(S&P500 종가)는 벤치마크 화면과 함께 폐지. Supabase 대시보드에 배포본이 남아 있으면 지워도 된다.
