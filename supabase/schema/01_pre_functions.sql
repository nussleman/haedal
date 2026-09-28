-- 01 · 테이블 기본값이 먼저 필요로 하는 함수
-- 스냅샷: 2026-09-28 · 원본 DB 와 md5 대조 완료 (verify.sql)

CREATE OR REPLACE FUNCTION public.today_kst()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (now() at time zone 'Asia/Seoul')::date;
$function$
;
