-- 09 · RLS 정책
-- 스냅샷: 2026-09-28 · 원본 DB 와 md5 대조 완료 (verify.sql)

create policy "own rows" on public.accounts as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy app_settings_owner_all on public.app_settings as permissive for all to public
  using ((owner_id = ( SELECT auth.uid() AS uid)))
  with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "own rows" on public.asset_snapshots as permissive for all to authenticated
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.braindump_archive as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.braindump_blocks as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.career_positions as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.categories as permissive for all to authenticated
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.characters as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.countries as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "editor delete" on public.date_balance_checks as permissive for delete to authenticated
  using ((is_date_member(book_id) AND date_is_editor()));
create policy "editor update" on public.date_balance_checks as permissive for update to authenticated
  using ((is_date_member(book_id) AND date_is_editor()))
  with check ((is_date_member(book_id) AND date_is_editor()));
create policy "editor write" on public.date_balance_checks as permissive for insert to authenticated
  with check ((is_date_member(book_id) AND date_is_editor()));
create policy "members read" on public.date_balance_checks as permissive for select to authenticated
  using (is_date_member(book_id));
create policy "editor update" on public.date_books as permissive for update to authenticated
  using ((is_date_member(id) AND date_is_editor()))
  with check ((is_date_member(id) AND date_is_editor()));
create policy "members read" on public.date_books as permissive for select to authenticated
  using (is_date_member(id));
create policy "members read" on public.date_members as permissive for select to authenticated
  using (is_date_member(book_id));
create policy "editor delete" on public.date_tx as permissive for delete to authenticated
  using ((is_date_member(book_id) AND date_is_editor()));
create policy "editor update" on public.date_tx as permissive for update to authenticated
  using ((is_date_member(book_id) AND date_is_editor()))
  with check ((is_date_member(book_id) AND date_is_editor()));
create policy "editor write" on public.date_tx as permissive for insert to authenticated
  with check ((is_date_member(book_id) AND date_is_editor()));
create policy "members read" on public.date_tx as permissive for select to authenticated
  using (is_date_member(book_id));
create policy "own rows" on public.drawings as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.goal_files as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.goal_links as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.goals as permissive for all to authenticated
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.holdings as permissive for all to authenticated
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.job_applications as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.life_event_people as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM life_events e
  WHERE ((e.id = life_event_people.event_id) AND (e.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM life_events e
  WHERE ((e.id = life_event_people.event_id) AND (e.owner_id = ( SELECT auth.uid() AS uid))))));
create policy "own rows" on public.life_events as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.life_group_people as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM life_groups g
  WHERE ((g.id = life_group_people.group_id) AND (g.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM life_groups g
  WHERE ((g.id = life_group_people.group_id) AND (g.owner_id = ( SELECT auth.uid() AS uid))))));
create policy "own rows" on public.life_groups as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.life_people as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.media_characters as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_characters.media_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_characters.media_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy "own rows" on public.media_collection_items as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM media_collections c
  WHERE ((c.id = media_collection_items.collection_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM media_collections c
  WHERE ((c.id = media_collection_items.collection_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))));
create policy "own rows" on public.media_collections as permissive for all to authenticated
  using ((owner_id = ( SELECT auth.uid() AS uid)))
  with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "own rows" on public.media_countries as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_countries.media_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_countries.media_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy "own rows" on public.media_credits as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_credits.media_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_credits.media_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy "own rows" on public.media_items as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.media_relations as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_relations.from_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_relations.from_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy "own rows" on public.media_series as permissive for all to authenticated
  using ((owner_id = ( SELECT auth.uid() AS uid)))
  with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "own rows" on public.media_tags as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_tags.media_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM media_items p
  WHERE ((p.id = media_tags.media_id) AND (p.owner_id = ( SELECT auth.uid() AS uid))))));
create policy "own rows" on public.merchant_groups as permissive for all to authenticated
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.merchants as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.people as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.routine_logs as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.routine_spans as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.routines as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.stocks as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.study_cards as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.tags as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.themes as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.transactions as permissive for all to authenticated
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));


-- 2026-09-28 토스·종목 팩트 (migrations/20260928000006)
create policy "own rows" on public.toss_summary as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id)) with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.toss_holdings as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id)) with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.toss_daily as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id)) with check ((( SELECT auth.uid() AS uid) = owner_id));
create policy "own rows" on public.drawing_eras as permissive for all to public
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));
