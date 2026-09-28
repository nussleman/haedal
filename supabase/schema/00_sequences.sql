-- 00 · 시퀀스 (identity 가 아닌 옛 id 열용)
-- 스냅샷: 2026-09-28 · 원본 DB 와 md5 대조 완료 (verify.sql)

create sequence if not exists public.life_events_id_seq;
create sequence if not exists public.life_groups_id_seq;
create sequence if not exists public.life_people_id_seq;
create sequence if not exists public.routine_logs_id_seq;
create sequence if not exists public.routine_spans_id_seq;
create sequence if not exists public.routines_id_seq;
