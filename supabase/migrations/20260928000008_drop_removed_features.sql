-- 2026-09-28 '돈 관리 본질' 정리로 화면을 지우면서 더 이상 아무도 읽지 않는 테이블을 지운다.
--  · trade_log     : 매매일지 (0건)
--  · stock_facts   : 종목 판정용 팩트 (원본은 구글 시트 '종목_팩트' 탭에 그대로 있음)
--  · index_prices  : 벤치마크 S&P500 월말 종가 (공개 시장 데이터, 필요하면 다시 받으면 됨)
-- holdings(예전 보유종목)는 goal_progress 뷰가 참조해서 남긴다 (코알라 앱이 쓸 수 있음).
-- study_cards(종목 스터디 카드 5장)는 직접 쓴 메모가 있어 남겨 둔다 — 화면에서는 더 이상 쓰지 않는다.
drop table if exists public.trade_log;
drop function if exists public.trade_log_touch();
drop table if exists public.stock_facts;
drop table if exists public.index_prices;
delete from public.app_settings where key = 'fixed_review';
