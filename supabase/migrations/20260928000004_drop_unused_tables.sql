-- 해달·코알라 어느 코드에서도 쓰지 않는 테이블 정리 (2026-09-28, 태준 확인)
-- savings_log 만 2건 있었고(얻어먹음 기록, 기능은 이미 화면에서 빠짐) 나머지는 모두 빈 테이블
drop table public.circle_media;
drop table public.circle_memories;
drop table public.event_media;
drop table public.event_memories;
drop table public.drawing_memories;
drop table public.drawing_tags;
drop table public.memory_photos;
drop table public.events;
drop table public.circles;
drop table public.memories;
drop table public.thesis;
drop table public.debts;
drop table public.savings_log;
