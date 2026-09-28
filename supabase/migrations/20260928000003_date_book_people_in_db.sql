-- 데이트 통장: 코드에 박혀 있던 이메일·이름을 통장(date_books) 설정으로 옮긴다
-- (실제 값은 데이터로만 넣었고, 이 파일에는 개인 정보를 두지 않는다)
alter table public.date_books
  add column allowed_emails text[] not null default '{}',
  add column editor_emails  text[] not null default '{}',
  add column people         text[] not null default '{}';
-- update public.date_books set allowed_emails = array[...], editor_emails = array[...], people = array[...];

create or replace function public.date_couple_emails()
 returns text[] language sql stable security definer set search_path = ''
as $$ select coalesce(array_agg(distinct lower(e)), '{}') from public.date_books b, unnest(b.allowed_emails) e $$;

create or replace function public.date_is_editor()
 returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.date_books b
                     where lower(coalesce(auth.jwt() ->> 'email', '')) = any (b.editor_emails)) $$;

create or replace function public.date_email_allowed(em text)
 returns boolean language sql stable security definer set search_path = ''
as $$ select lower(trim(coalesce(em, ''))) = any (public.date_couple_emails()) $$;
revoke all on function public.date_couple_emails() from public, anon, authenticated;
grant execute on function public.date_email_allowed(text) to anon, authenticated;
grant execute on function public.date_is_editor() to authenticated;

alter table public.date_tx drop constraint date_tx_depositor_check;
create or replace function public.date_tx_check_depositor()
 returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.depositor is not null and not exists (
       select 1 from public.date_books b where b.id = new.book_id and new.depositor = any (b.people)) then
    raise exception '통장에 등록된 사람이 아닙니다: %', new.depositor;
  end if;
  return new;
end $$;
create trigger date_tx_check_depositor before insert or update of depositor, book_id on public.date_tx
  for each row execute function public.date_tx_check_depositor();
