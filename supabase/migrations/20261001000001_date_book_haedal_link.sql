-- 말랑한 통장: 해달 입출금 내역에 적은 '그 통장으로 보낸 돈 / 받은 돈'을 통장 기록(date_tx)으로 자동 반영한다.
-- 어느 사람의 어떤 사용처를 연결할지는 date_books 의 link_* 에 데이터로만 넣는다 (이 파일에는 개인 정보 없음).
--   update public.date_books set link_owner = '<해달 사용자 uuid>', link_merchant = '<해달 사용처 이름>', link_depositor = '<입금자 이름>';
-- 해달 분류가 수입이면(통장 → 내 계좌) 통장에서는 지출(기타)로, 그 밖이면(내 계좌 → 통장) 입금으로 적는다.
-- 해달 기록을 고치면 통장 기록도 따라 바뀌고, 지우면(또는 사용처를 바꾸면) 통장 기록도 지워진다.

alter table public.date_books
  add column link_owner     uuid,
  add column link_merchant  text,
  add column link_depositor text;

alter table public.date_tx
  add column haedal_tx_id bigint;
alter table public.date_tx add constraint date_tx_haedal_tx_id_key UNIQUE (haedal_tx_id);
alter table public.date_tx add constraint date_tx_haedal_tx_id_fkey FOREIGN KEY (haedal_tx_id) REFERENCES transactions(id) ON DELETE CASCADE;

create or replace function public.date_sync_from_haedal()
 returns trigger language plpgsql security definer set search_path = ''
as $$
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
end $$;
revoke all on function public.date_sync_from_haedal() from public, anon, authenticated;

create trigger date_sync_from_haedal after insert or update of date, category_id, amount, merchant, note, owner_id
  on public.transactions for each row execute function public.date_sync_from_haedal();

-- 통장 이름: 데이트 통장 → 말랑한 통장 (새로 만들 때의 기본값도)
alter table public.date_books alter column name set default '말랑한 통장'::text;
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
