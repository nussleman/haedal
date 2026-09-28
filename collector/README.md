# collector/ — 토스증권 수집기 (맥북에서 실행)

토스 Open API 는 등록된 IP 에서만 부를 수 있어서, IP 가 등록된 맥북이 15분마다 조회해
Supabase `toss_ingest()` 로 보낸다. 대시보드는 `toss_summary` · `toss_holdings` · `toss_daily` 를 읽는다.

- 실제 실행 위치: 맥 `~/haedal/` (launchd `com.haedal.toss`, 15분 간격)
- 이 폴더의 파일은 사본이다. 고치면 맥의 `~/haedal/` 에도 같이 반영할 것.
- 비밀값은 저장소에 없다
  - `TOSS_ID` / `TOSS_SECRET` : launchd plist 환경변수
  - `~/haedal/.ingest_key` : Supabase 로 보내는 수집기 전용 값. DB 에는 sha256 만 (`private.ingest_keys`)
- 키를 바꾸려면: 새 값을 `.ingest_key` 에 쓰고, 그 sha256 을 `private.ingest_keys` 에 넣고, 옛 줄을 지운다.

```
python3 toss_collector.py --dry-run   # 조회만
python3 toss_collector.py             # 조회 + DB 기록
```
