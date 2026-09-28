-- 05 · 함수
-- 스냅샷: 2026-09-28 · 원본 DB 와 md5 대조 완료 (verify.sql)

CREATE OR REPLACE FUNCTION public.braindump_on(d date)
 RETURNS SETOF braindump_blocks
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with recursive hit as (
    select b.* from public.braindump_blocks b
     where b.owner_id = auth.uid()
       and b.opened_on <= d
       and (b.done_on is null or b.done_on >= d)
       and (b.deleted_on is null or b.deleted_on > d)
  ),
  tree as (
    select * from hit
    union
    select p.* from public.braindump_blocks p join tree t on p.id = t.parent_id
  )
  select * from tree order by section, position;
$function$
;
CREATE OR REPLACE FUNCTION public.braindump_today()
 RETURNS SETOF braindump_blocks
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select * from public.braindump_on(public.today_kst());
$function$
;
CREATE OR REPLACE FUNCTION public.date_couple_emails()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select array['gksxowns@gmail.com', 'min2114@naver.com'] $function$
;
CREATE OR REPLACE FUNCTION public.date_enter()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); b bigint;
begin
  if auth.uid() is null or not (em = any (public.date_couple_emails())) then
    raise exception '이 통장에 들어올 수 없는 계정입니다';
  end if;
  perform pg_advisory_xact_lock(hashtext('date_enter'));
  select id into b from public.date_books order by id limit 1;
  if b is null then
    insert into public.date_books (name, created_by) values ('데이트 통장', auth.uid()) returning id into b;
  end if;
  insert into public.date_members (book_id, user_id, nickname)
    values (b, auth.uid(), split_part(em, '@', 1))
    on conflict (book_id, user_id) do nothing;
  return b;
end $function$
;
CREATE OR REPLACE FUNCTION public.date_is_editor()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select lower(coalesce(auth.jwt() ->> 'email', '')) = 'gksxowns@gmail.com' $function$
;
CREATE OR REPLACE FUNCTION public.is_date_member(b bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.date_members where book_id = b and user_id = auth.uid());
$function$
;
CREATE OR REPLACE FUNCTION public.study_cards_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin new.updated_at = now(); return new; end $function$
;
CREATE OR REPLACE FUNCTION public.today_kst()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (now() at time zone 'Asia/Seoul')::date;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.trade_log_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin new.updated_at = now(); return new; end $function$
;
