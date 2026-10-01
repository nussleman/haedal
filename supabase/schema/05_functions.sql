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
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select coalesce(array_agg(distinct lower(e)), '{}') from public.date_books b, unnest(b.allowed_emails) e $function$
;
CREATE OR REPLACE FUNCTION public.date_email_allowed(em text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select lower(trim(coalesce(em, ''))) = any (public.date_couple_emails()) $function$
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
    insert into public.date_books (name, created_by) values ('말랑한 통장', auth.uid()) returning id into b;
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
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select exists (select 1 from public.date_books b
                     where lower(coalesce(auth.jwt() ->> 'email', '')) = any (b.editor_emails)) $function$
;
CREATE OR REPLACE FUNCTION public.date_sync_from_haedal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.date_books;
  ck text;
  k text;
begin
  select * into b from public.date_books
   where link_owner = new.owner_id and link_merchant = new.merchant
   order by id limit 1;
  if not found or coalesce(new.amount, 0) = 0 then
    -- 사용처가 바뀌어 더는 연결 대상이 아니면 통장 쪽 기록을 지운다
    if tg_op = 'UPDATE' then delete from public.date_tx where haedal_tx_id = new.id; end if;
    return new;
  end if;
  select c.kind into ck from public.categories c where c.id = new.category_id;
  k := case when ck = '수입' then '지출' else '입금' end;
  insert into public.date_tx (book_id, date, kind, amount, category, merchant, memo, depositor, created_by, haedal_tx_id)
  values (b.id, new.date, k, abs(new.amount),
          case when k = '지출' then '기타' end,
          case when k = '지출' then b.link_depositor || ' 계좌로' end,
          new.note,
          case when k = '입금' then b.link_depositor end,
          new.owner_id, new.id)
  on conflict (haedal_tx_id) do update
    set book_id = excluded.book_id, date = excluded.date, kind = excluded.kind, amount = excluded.amount,
        category = excluded.category, merchant = excluded.merchant, memo = excluded.memo,
        depositor = excluded.depositor, good_bad = null, updated_at = now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.date_tx_check_depositor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.depositor is not null and not exists (
       select 1 from public.date_books b where b.id = new.book_id and new.depositor = any (b.people)) then
    raise exception '통장에 등록된 사람이 아닙니다: %', new.depositor;
  end if;
  return new;
end $function$
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


-- 2026-09-28 토스·종목 팩트 (migrations/20260928000006)
create or replace function public.toss_ingest(p_secret text, p_summary jsonb, p_holdings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_at timestamptz;
  v_n integer;
begin
  select k.owner_id into v_owner from private.ingest_keys k
   where k.key_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');
  if v_owner is null then
    raise exception 'bad secret' using errcode = '28000';
  end if;
  if jsonb_typeof(p_summary) <> 'object' or jsonb_typeof(p_holdings) <> 'array' then
    raise exception 'bad payload';
  end if;
  v_at := coalesce(nullif(p_summary->>'asOf', '')::timestamp at time zone 'Asia/Seoul', now());
  if exists (select 1 from public.toss_summary t where t.owner_id = v_owner and t.as_of > v_at) then
    return jsonb_build_object('ok', true, 'skipped', 'older', 'asOf', v_at);
  end if;
  insert into public.toss_summary as t (owner_id, as_of, value, cost, pl, pl_rate, cash, total, fx, count, daily, updated_at)
  values (v_owner, v_at, (p_summary->>'value')::bigint, (p_summary->>'cost')::bigint, (p_summary->>'pl')::bigint,
          (p_summary->>'plRate')::double precision, (p_summary->>'cash')::bigint, (p_summary->>'total')::bigint,
          (p_summary->>'fx')::double precision, (p_summary->>'count')::integer, (p_summary->>'daily')::bigint, now())
  on conflict (owner_id) do update set
    as_of = excluded.as_of, value = excluded.value, cost = excluded.cost, pl = excluded.pl, pl_rate = excluded.pl_rate,
    cash = excluded.cash, total = excluded.total, fx = excluded.fx, count = excluded.count, daily = excluded.daily,
    updated_at = now();
  delete from public.toss_holdings where owner_id = v_owner;
  insert into public.toss_holdings (owner_id, symbol, name, country, currency, qty, avg, last,
                                    value_krw, cost_krw, pl_krw, pl_rate, as_of)
  select v_owner, coalesce(nullif(h->>'symbol', ''), h->>'name'), h->>'name', h->>'country', h->>'currency',
         (h->>'qty')::double precision, (h->>'avg')::double precision, (h->>'last')::double precision,
         (h->>'valueKrw')::bigint, (h->>'costKrw')::bigint, (h->>'plKrw')::bigint, (h->>'plRate')::double precision, v_at
    from jsonb_array_elements(p_holdings) h
   where coalesce(h->>'name', '') <> ''
  on conflict (owner_id, symbol) do nothing;
  get diagnostics v_n = row_count;
  insert into public.toss_daily as d (owner_id, date, total, value, cost, pl, pl_rate, cash, count, last_at)
  values (v_owner, (v_at at time zone 'Asia/Seoul')::date, (p_summary->>'total')::bigint, (p_summary->>'value')::bigint,
          (p_summary->>'cost')::bigint, (p_summary->>'pl')::bigint, (p_summary->>'plRate')::double precision,
          (p_summary->>'cash')::bigint, (p_summary->>'count')::integer, v_at)
  on conflict (owner_id, date) do update set
    total = excluded.total, value = excluded.value, cost = excluded.cost, pl = excluded.pl, pl_rate = excluded.pl_rate,
    cash = excluded.cash, count = excluded.count, last_at = excluded.last_at
  where d.last_at is null or excluded.last_at >= d.last_at;
  return jsonb_build_object('ok', true, 'holdings', v_n, 'asOf', v_at);
end;
$$;

revoke all on function public.toss_ingest(text, jsonb, jsonb) from public;
grant execute on function public.toss_ingest(text, jsonb, jsonb) to anon;

-- 코알라 앱 변경 반영 (2026-09-28)
CREATE OR REPLACE FUNCTION public.media_routine_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare x record;
begin
  for x in
    select distinct r.id rid, dd.d
      from routines r,
           (select OLD.finished_on d, OLD.kind k, OLD.owner_id o where TG_OP <> 'INSERT'
            union all select NEW.finished_on, NEW.kind, NEW.owner_id where TG_OP <> 'DELETE') dd
     where dd.d is not null and r.owner_id = dd.o and dd.k = any(r.media_kinds)
  loop
    perform routine_media_sync(x.rid, x.d);
  end loop;
  return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.on_this_day(d date, win integer DEFAULT 3)
 RETURNS TABLE(src text, id text, title text, on_date date, kind text, cover text, gap integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with x as (
    select 'event'::text src, e.id::text id, e.title, e.happened_on on_date, e.kind, e.cover_url cover
      from life_events e where e.happened_on is not null and coalesce(e.precision,'day') = 'day'
    union all
    select 'media', m.id::text, m.title, m.finished_on, m.kind, m.cover_url
      from media_items m where m.finished_on is not null and m.status = 'done'
    union all
    select 'drawing', g.id::text, g.title, g.finished_on, g.medium, g.thumb_url
      from drawings g where g.finished_on is not null and g.date_prec = 'day'
  )
  select src, id, title, on_date, kind, cover,
         ((on_date + make_interval(years => (extract(year from d) - extract(year from on_date))::int))::date - d)::int gap
    from x
   where extract(year from on_date) < extract(year from d)
     and abs(((on_date + make_interval(years => (extract(year from d) - extract(year from on_date))::int))::date - d)) <= win
   order by abs(((on_date + make_interval(years => (extract(year from d) - extract(year from on_date))::int))::date - d)), on_date desc
   limit 60;
$function$
;
CREATE OR REPLACE FUNCTION public.routine_media_relink()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare x record;
begin
  if NEW.media_kinds is not distinct from OLD.media_kinds
     and NEW.started_on is not distinct from OLD.started_on and NEW.ended_on is not distinct from OLD.ended_on then return null; end if;
  for x in
    select distinct d from (
      select on_date d from routine_logs where routine_id = NEW.id and media_id is not null
      union select finished_on from media_items where owner_id = NEW.owner_id and status = 'done'
        and finished_on is not null and kind = any(NEW.media_kinds)) s
  loop perform routine_media_sync(NEW.id, x.d); end loop;
  return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.routine_media_sync(rid bigint, d date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r routines; m record;
begin
  select * into r from routines where id = rid;
  if r.id is null or d is null then return; end if;
  select mi.id, mi.title into m from media_items mi
   where mi.owner_id = r.owner_id and mi.status = 'done' and mi.finished_on = d
     and mi.kind = any(r.media_kinds)
     and d >= coalesce(r.started_on, r.created_at::date)
     and (r.ended_on is null or d <= r.ended_on)
   order by mi.updated_at desc nulls last limit 1;
  if m.id is null then
    delete from routine_logs where routine_id = rid and on_date = d and media_id is not null;
    return;
  end if;
  insert into routine_logs(owner_id, routine_id, on_date, status, count, media_id, note)
  values (r.owner_id, rid, d, 'done', greatest(coalesce(r.target_count,1),1), m.id, m.title)
  on conflict (routine_id, on_date) do update
     set media_id = excluded.media_id, note = excluded.note
   where routine_logs.media_id is not null;              -- 자동 체크끼리만 바꿔 끼운다
end $function$
;
