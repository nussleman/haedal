-- 벤치마크용 지수 월말 종가 (공용 시장 데이터, 사용자 소유 아님)
-- 초기값은 시트 '지수_S&P500' 탭(2023-03 ~ 2026-08)에서 옮김. 이후는 index-refresh 함수가 채움.
create table public.index_prices (
  symbol text not null default 'SPX',
  month date not null,
  close numeric not null,
  source text,
  updated_at timestamptz not null default now(),
  primary key (symbol, month)
);
alter table public.index_prices enable row level security;
create policy "signed-in read" on public.index_prices for select to authenticated using (true);
