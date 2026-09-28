-- 08 · RLS 켜기
-- 스냅샷: 2026-09-28 · 원본 DB 와 md5 대조 완료 (verify.sql)

alter table public.accounts enable row level security;
alter table public.app_settings enable row level security;
alter table public.asset_snapshots enable row level security;
alter table public.braindump_archive enable row level security;
alter table public.braindump_blocks enable row level security;
alter table public.career_positions enable row level security;
alter table public.categories enable row level security;
alter table public.characters enable row level security;
alter table public.countries enable row level security;
alter table public.date_balance_checks enable row level security;
alter table public.date_books enable row level security;
alter table public.date_members enable row level security;
alter table public.date_tx enable row level security;
alter table public.drawings enable row level security;
alter table public.goal_files enable row level security;
alter table public.goal_links enable row level security;
alter table public.goals enable row level security;
alter table public.holdings enable row level security;
alter table public.index_prices enable row level security;
alter table public.job_applications enable row level security;
alter table public.life_event_people enable row level security;
alter table public.life_events enable row level security;
alter table public.life_group_people enable row level security;
alter table public.life_groups enable row level security;
alter table public.life_people enable row level security;
alter table public.media_characters enable row level security;
alter table public.media_collection_items enable row level security;
alter table public.media_collections enable row level security;
alter table public.media_countries enable row level security;
alter table public.media_credits enable row level security;
alter table public.media_items enable row level security;
alter table public.media_relations enable row level security;
alter table public.media_series enable row level security;
alter table public.media_tags enable row level security;
alter table public.merchant_groups enable row level security;
alter table public.merchants enable row level security;
alter table public.people enable row level security;
alter table public.routine_logs enable row level security;
alter table public.routine_spans enable row level security;
alter table public.routines enable row level security;
alter table public.stocks enable row level security;
alter table public.study_cards enable row level security;
alter table public.tags enable row level security;
alter table public.themes enable row level security;
alter table public.trade_log enable row level security;
alter table public.transactions enable row level security;


-- 2026-09-28 토스·종목 팩트 (migrations/20260928000006)
alter table public.toss_summary enable row level security;
alter table public.toss_holdings enable row level security;
alter table public.toss_daily enable row level security;
alter table public.stock_facts enable row level security;
alter table public.drawing_eras enable row level security;
