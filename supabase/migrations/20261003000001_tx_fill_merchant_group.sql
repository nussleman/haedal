-- 사용처 그룹(사용처의 '분류') 자동 채우기
-- 폰 앱 빠른 기록은 사용처 사전(merchants)에 그룹이 적혀 있을 때만 그룹을 함께 저장했다.
-- 사전에 없는 가게(대부분)는 예전 기록에 그룹이 있어도 빈칸으로 들어가, 웹 내역에서 사용처 이름만 보였다.
-- 이제 어느 화면에서 기록하든 DB 가 채운다: 그룹 없이 들어온 기록은
--   ① 사용처 사전의 그룹 → ② 같은 사용처의 가장 최근 기록에 붙은 그룹 순으로 물려받는다.
-- 그룹을 직접 적어 넣었거나, 나중에 고쳐서 비운 기록(UPDATE)은 건드리지 않는다.

create or replace function public.tx_fill_merchant_group()
 returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.merchant_group is null and coalesce(trim(new.merchant), '') <> '' then
    select m.merchant_group into new.merchant_group
      from public.merchants m
     where m.owner_id = new.owner_id and m.name = trim(new.merchant) and m.merchant_group is not null
     limit 1;
    if new.merchant_group is null then
      select t.merchant_group into new.merchant_group
        from public.transactions t
       where t.owner_id = new.owner_id and t.merchant = new.merchant and t.merchant_group is not null
       order by t.date desc, t.id desc
       limit 1;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tx_fill_merchant_group() from public, anon, authenticated;

create trigger tx_fill_merchant_group before insert on public.transactions
  for each row execute function public.tx_fill_merchant_group();

-- 이미 그룹 없이 들어간 기록 중, 같은 사용처의 그룹이 하나로 정해져 있는 것만 채운다
update public.transactions t
   set merchant_group = g.merchant_group
  from (select owner_id, merchant, min(merchant_group) merchant_group
          from public.transactions
         where merchant_group is not null and merchant is not null
         group by owner_id, merchant
        having count(distinct merchant_group) = 1) g
 where t.merchant_group is null and t.owner_id = g.owner_id and t.merchant = g.merchant;
