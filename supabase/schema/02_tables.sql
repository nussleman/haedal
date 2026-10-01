-- 02 · 테이블
-- 스냅샷: 2026-09-28 · 원본 DB 와 md5 대조 완료 (verify.sql)

create table public.accounts (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  asset_class text not null,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  note text,
  created_at timestamp with time zone default now() not null
);

create table public.app_settings (
  owner_id uuid default auth.uid() not null,
  key text not null,
  value jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table public.asset_snapshots (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  month date not null,
  asset_class text not null,
  account text not null,
  amount numeric(14,2) not null,
  created_at timestamp with time zone default now() not null
);

create table public.braindump_archive (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  entry_date date not null,
  title text,
  body_md text not null,
  notion_id text,
  created_at timestamp with time zone default now() not null
);

create table public.braindump_blocks (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  section text not null,
  block_type text default 'task'::text not null,
  content text default ''::text not null,
  "position" numeric not null,
  opened_on date default today_kst() not null,
  done_on date,
  deleted_on date,
  notion_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  parent_id uuid,
  priority smallint default 0 not null,
  is_wip boolean default false not null,
  bucket text default 'today'::text not null,
  is_waiting boolean default false not null,
  is_event boolean default false not null,
  event_on date,
  event_at time without time zone,
  event_end time without time zone,
  event_place text,
  event_with text,
  rel_people bigint[] default '{}'::bigint[] not null,
  rel_groups bigint[] default '{}'::bigint[] not null,
  is_today boolean default false not null
);

create table public.career_positions (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  notion_id text,
  company text not null,
  title text,
  started_on date,
  ended_on date,
  note text,
  "position" numeric,
  created_at timestamp with time zone default now() not null,
  dept text,
  grade text,
  employment_type text,
  salary numeric,
  summary text,
  achievements text,
  leave_reason text
);

create table public.categories (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  kind text not null,
  category text not null,
  subcategory text not null,
  emoji_kind text,
  emoji_category text,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table public.characters (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  notion_id text,
  name text not null,
  note text,
  created_at timestamp with time zone default now() not null,
  cover_url text
);

create table public.countries (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  notion_id text,
  name text not null,
  created_at timestamp with time zone default now() not null
);

create table public.date_balance_checks (
  id bigint generated always as identity not null,
  book_id bigint not null,
  on_date date default ((now() AT TIME ZONE 'Asia/Seoul'::text))::date not null,
  amount numeric(14,2) not null,
  note text,
  created_by uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null
);

create table public.date_books (
  id bigint generated always as identity not null,
  name text default '말랑한 통장'::text not null,
  invite_code text default substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 10) not null,
  opening_balance numeric(14,2) default 0 not null,
  opening_on date,
  categories text[] default '{식사,카페,술,문화·여가,여행,교통,선물,생활,기타}'::text[] not null,
  created_by uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null,
  deposit_goals jsonb default '{}'::jsonb not null,
  allowed_emails text[] default '{}'::text[] not null,
  editor_emails text[] default '{}'::text[] not null,
  people text[] default '{}'::text[] not null,
  link_owner uuid,
  link_merchant text,
  link_depositor text
);

create table public.date_members (
  book_id bigint not null,
  user_id uuid not null,
  nickname text not null,
  monthly_deposit numeric(14,2) default 0 not null,
  joined_at timestamp with time zone default now() not null
);

create table public.date_tx (
  id bigint generated always as identity not null,
  book_id bigint not null,
  date date default ((now() AT TIME ZONE 'Asia/Seoul'::text))::date not null,
  kind text not null,
  amount numeric(14,2) not null,
  category text,
  merchant text,
  memo text,
  good_bad text,
  created_by uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  depositor text,
  haedal_tx_id bigint
);

create table public.drawing_eras (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  started_on date not null,
  ended_on date,
  color text,
  note text,
  created_at timestamp with time zone default now() not null
);

create table public.drawings (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  notion_id text,
  title text,
  description text,
  status text default 'done'::text,
  is_favorite boolean default false not null,
  started_on date,
  finished_on date,
  image_url text,
  thumb_url text,
  width integer,
  height integer,
  byte_size bigint,
  created_at timestamp with time zone default now() not null,
  tags text[] default '{}'::text[] not null,
  medium text,
  date_prec text default 'day'::text not null
);

create table public.goal_files (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  goal_id bigint not null,
  storage_path text not null,
  file_name text,
  mime_type text,
  byte_size bigint,
  "position" numeric,
  created_at timestamp with time zone default now() not null
);

create table public.goal_links (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  from_goal_id bigint not null,
  to_goal_id bigint not null,
  kind text not null,
  created_at timestamp with time zone default now() not null
);

create table public.goals (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  period text,
  kind text,
  item text not null,
  frequency text,
  target_amount numeric(14,2),
  target_ratio numeric(10,4),
  status text default '대기'::text not null,
  achieved_on date,
  note text,
  created_at timestamp with time zone default now() not null,
  categories text[] default '{}'::text[] not null,
  target_on date,
  is_bucketlist boolean default false not null,
  current_value numeric,
  target_value numeric,
  unit text,
  metric_source text,
  metric_params jsonb default '{}'::jsonb not null,
  "position" numeric,
  notion_id text,
  updated_at timestamp with time zone default now() not null,
  emoji text
);

create table public.holdings (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  snapshot_at timestamp with time zone not null,
  name text not null,
  ticker text,
  market text,
  currency text,
  quantity numeric(20,8),
  avg_price numeric(20,8),
  price numeric(20,8),
  value numeric(14,2),
  cost numeric(14,2),
  pnl numeric(14,2),
  pnl_pct numeric(10,4),
  weight numeric(10,4),
  created_at timestamp with time zone default now() not null
);

create table public.job_applications (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  notion_id text,
  company text not null,
  role text,
  status text,
  applied_on date,
  note text,
  created_at timestamp with time zone default now() not null,
  ended_on date,
  channels text[] default '{}'::text[] not null,
  url text
);

create table public.life_event_people (
  event_id bigint not null,
  person_id bigint not null
);

create table public.life_events (
  id bigint default nextval('life_events_id_seq'::regclass) not null,
  owner_id uuid default auth.uid() not null,
  title text not null,
  kind text default '일상'::text not null,
  weight text default '기억'::text not null,
  happened_on date,
  happened_end date,
  "precision" text default 'day'::text not null,
  place text,
  summary text,
  note text,
  cover_url text,
  tags text[] default '{}'::text[] not null,
  goal_id bigint,
  position_id uuid,
  notion_id text,
  created_at timestamp with time zone default now() not null,
  era text,
  group_id bigint
);

create table public.life_group_people (
  group_id bigint not null,
  person_id bigint not null,
  role text
);

create table public.life_groups (
  id bigint default nextval('life_groups_id_seq'::regclass) not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  emoji text,
  note text,
  started_on date,
  ended_on date,
  created_at timestamp with time zone default now() not null,
  tags text[] default '{}'::text[] not null
);

create table public.life_people (
  id bigint default nextval('life_people_id_seq'::regclass) not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  relation text,
  note text,
  created_at timestamp with time zone default now() not null,
  detail text,
  relations text[] default '{}'::text[] not null
);

create table public.media_characters (
  media_id uuid not null,
  character_id uuid not null,
  person_id uuid,
  cast_note text,
  pos numeric,
  cover_url text
);

create table public.media_collection_items (
  collection_id uuid not null,
  media_id uuid not null,
  added_at timestamp with time zone default now() not null
);

create table public.media_collections (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  note text,
  created_at timestamp with time zone default now() not null
);

create table public.media_countries (
  media_id uuid not null,
  country_id uuid not null
);

create table public.media_credits (
  media_id uuid not null,
  person_id uuid not null,
  role text not null,
  role_detail text,
  id bigint generated always as identity not null
);

create table public.media_items (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  notion_id text,
  title text not null,
  original_title text,
  kind text,
  status text default 'default'::text,
  rating numeric,
  one_liner text,
  note text,
  release_year integer,
  started_on date,
  finished_on date,
  times text,
  is_lifetime boolean default false not null,
  amateur_pro text,
  cover_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  series_id uuid,
  series_pos numeric
);

create table public.media_relations (
  from_id uuid not null,
  to_id uuid not null,
  kind text default 'related'::text not null
);

create table public.media_series (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  created_at timestamp with time zone default now() not null
);

create table public.media_tags (
  media_id uuid not null,
  tag_id uuid not null
);

create table public.merchant_groups (
  id bigint generated by default as identity not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  emoji text,
  created_at timestamp with time zone default now() not null
);

create table public.merchants (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  merchant_group text,
  created_at timestamp with time zone default now() not null,
  is_fixed boolean default false not null
);

create table public.people (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  notion_id text,
  name text not null,
  kind text default 'person'::text not null,
  note text,
  created_at timestamp with time zone default now() not null,
  cover_url text
);

create table public.routine_logs (
  id bigint default nextval('routine_logs_id_seq'::regclass) not null,
  owner_id uuid default auth.uid() not null,
  routine_id bigint not null,
  on_date date not null,
  status text default 'done'::text not null,
  count integer default 1 not null,
  amount numeric,
  note text,
  created_at timestamp with time zone default now() not null,
  media_id uuid
);

create table public.routine_spans (
  id bigint default nextval('routine_spans_id_seq'::regclass) not null,
  owner_id uuid default auth.uid() not null,
  routine_id bigint not null,
  started_on date not null,
  ended_on date,
  note text,
  created_at timestamp with time zone default now() not null
);

create table public.routines (
  id bigint default nextval('routines_id_seq'::regclass) not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  emoji text,
  categories text[] default '{}'::text[] not null,
  freq_type text default 'daily'::text not null,
  freq_n integer,
  weekdays integer[] default '{}'::integer[] not null,
  target_count integer default 1 not null,
  unit text,
  goal_id bigint,
  started_on date,
  ended_on date,
  is_active boolean default true not null,
  note text,
  "position" numeric default 0 not null,
  created_at timestamp with time zone default now() not null,
  time_slot text,
  media_kinds text[] default '{}'::text[] not null
);

create table public.stocks (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  ticker text,
  market text,
  category text,
  themes jsonb default '[]'::jsonb not null,
  is_active boolean default true not null,
  note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.study_cards (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  ticker text,
  type text,
  gate0 jsonb default '{}'::jsonb not null,
  gate1 jsonb default '[]'::jsonb not null,
  gate2 jsonb default '{}'::jsonb not null,
  score integer,
  why_not text,
  resolve_when text,
  resolve_how text,
  buy_reason text,
  falsify1 text,
  falsify2 text,
  check_date date,
  stop text,
  take text,
  weight numeric,
  verdict text,
  memo text,
  val jsonb default '{}'::jsonb not null,
  price numeric,
  updated_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  ans jsonb default '{}'::jsonb not null,
  chk jsonb default '{}'::jsonb not null,
  note_by_stage jsonb default '{}'::jsonb not null,
  non_equity text,
  sort_hint numeric,
  themes jsonb default '[]'::jsonb not null,
  grade_override text,
  watch_level text,
  watch_trigger text,
  watch_date date,
  watch_at timestamp with time zone
);

create table public.tags (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  kind text default 'media'::text not null,
  notion_id text,
  created_at timestamp with time zone default now() not null
);

create table public.themes (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  note text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table public.transactions (
  id bigint generated always as identity not null,
  owner_id uuid default auth.uid() not null,
  date date default CURRENT_DATE not null,
  category_id bigint not null,
  amount numeric(14,2) not null,
  merchant_group text,
  merchant text,
  note text,
  good_bad text,
  company_paid boolean default false not null,
  is_fixed boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);


-- 2026-09-28 토스·종목 팩트 (migrations/20260928000006)
create table public.toss_summary (
  owner_id uuid default auth.uid() not null,
  as_of timestamptz not null,
  value bigint, cost bigint, pl bigint, pl_rate double precision,
  cash bigint, total bigint, fx double precision, count integer, daily bigint,
  updated_at timestamptz default now() not null
);

create table public.toss_holdings (
  owner_id uuid default auth.uid() not null,
  symbol text not null,
  name text not null,
  country text, currency text,
  qty double precision, avg double precision, last double precision,
  value_krw bigint, cost_krw bigint, pl_krw bigint, pl_rate double precision,
  as_of timestamptz not null
);

create table public.toss_daily (
  owner_id uuid default auth.uid() not null,
  date date not null,
  total bigint, value bigint, cost bigint, pl bigint, pl_rate double precision,
  cash bigint, count integer,
  last_at timestamptz
);

-- 수집기 비밀값(해시) — API 로 노출되지 않는 private 스키마
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.ingest_keys (
  key_hash text primary key,
  owner_id uuid not null,
  label text,
  created_at timestamptz default now() not null
);
