# 🦦 해달

개인 자산관리 대시보드. 정적 사이트(GitHub Pages) + Supabase.

## 구조

```
index.html          대시보드 (js/ 파일을 순서대로 불러온다)
css/style.css       대시보드 스타일
js/
  core/             설정·상태, 계산, 화면 틀, Supabase 연결, 데이터 로딩
  entry/            기록 — 입출금 입력, 전체 내역, 사용처, 캘린더, 자산 스냅샷
  home/             홈
  goals/            목표 — 지표 정의, 보드·목록·편집기
  report/           리포트 — 월간, 연간
  invest/           투자 — 종목 표, 스터디, 벤치마크, 세금, 토스, 매매일지
  lab/              실험실 — 돋보기, 흐름표, 구조 시뮬레이션, 고정비 검토
  settings/         설정 — 분류·사용처·계좌·종목 목록, 예산, 적립
  panels/           여러 화면에 끼워 쓰는 패널 (자산배분, 부채, 운용 점검)
  boot.js           로그인 확인 후 시작 — 항상 마지막에 불러온다
shared/supabase.js  세 화면 공용 Supabase 연결 (키 · 라이브러리 버전 고정)
gagyebu.html        모바일 가계부 입력 앱 (PWA)
date/               데이트 통장 앱 (PWA)
supabase/           DB 변경 기록(migrations)과 Edge Function 소스
tests/              화면 회귀 검사
```

`js/` 파일은 모듈이 아닌 일반 스크립트라서 전역을 공유한다. `index.html`의 불러오는 순서를 바꾸지 말 것.

## 데이터

모든 데이터는 Supabase(`rjxmrpifrhybucexuvli`)가 원본이다. 테이블마다 RLS로 본인 행만 보인다.
코드에 들어 있는 Supabase 키는 공개용(anon) 키다.

## 검사

```
npm install
npm test     # 문법 검사 + 대시보드 전 메뉴·모바일 앱 2개 첫 화면을 HEAD 와 픽셀 비교
```
