-- 시트 탈출 마지막 단계: 토스 수집 결과와 종목_팩트를 DB 로 옮긴다.
--  · toss_summary  : 계좌 요약 — 사람마다 한 줄(가장 최근 값)
--  · toss_holdings : 보유 종목 — 수집할 때마다 통째로 바꿔 씀
--  · toss_daily    : 날짜별 계좌 총액 — 하루 한 줄, 그날 마지막 수집값
--  · stock_facts   : 종목별 팩트(유형·5단계·숫자·메모). 예전 시트 '종목_팩트' 탭
-- 맥의 toss_collector.py 는 toss_ingest() 를 부른다. 서비스 키 대신 수집기 전용 비밀값을 쓰고,
-- DB 에는 그 값의 sha256 만 남긴다 (private.ingest_keys).

create table public.toss_summary (
  owner_id uuid default auth.uid() not null,
  as_of timestamptz not null,
  value bigint, cost bigint, pl bigint, pl_rate double precision,
  cash bigint, total bigint, fx double precision, count integer, daily bigint,
  updated_at timestamptz default now() not null,
  primary key (owner_id)
);

create table public.toss_holdings (
  owner_id uuid default auth.uid() not null,
  symbol text not null,
  name text not null,
  country text, currency text,
  qty double precision, avg double precision, last double precision,
  value_krw bigint, cost_krw bigint, pl_krw bigint, pl_rate double precision,
  as_of timestamptz not null,
  primary key (owner_id, symbol)
);

create table public.toss_daily (
  owner_id uuid default auth.uid() not null,
  date date not null,
  total bigint, value bigint, cost bigint, pl bigint, pl_rate double precision,
  cash bigint, count integer,
  last_at timestamptz,
  primary key (owner_id, date)
);

create table public.stock_facts (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  ticker text,
  type_ko text,
  price text,
  checks jsonb default '{}'::jsonb not null,
  nums jsonb default '{}'::jsonb not null,
  stop_rule text, take_rule text, target_weight text, memo text,
  updated_at timestamptz default now() not null,
  primary key (id),
  unique (owner_id, name)
);

alter table public.toss_summary enable row level security;
alter table public.toss_holdings enable row level security;
alter table public.toss_daily enable row level security;
alter table public.stock_facts enable row level security;

create policy "own rows" on public.toss_summary as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id)) with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.toss_holdings as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id)) with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.toss_daily as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id)) with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.stock_facts as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id)) with check ((( SELECT auth.uid() AS uid) = owner_id));

-- 수집기 비밀값 (해시만). API 로 노출되지 않는 private 스키마
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.ingest_keys (
  key_hash text primary key,
  owner_id uuid not null,
  label text,
  created_at timestamptz default now() not null
);

-- 수집기가 부르는 함수: 비밀값 확인 → 요약 덮어쓰기 · 보유종목 교체 · 오늘 날짜 한 줄 갱신
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
grant execute on function public.toss_ingest(text, jsonb, jsonb) to anon, authenticated;
