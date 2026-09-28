-- 06 · 뷰
-- 스냅샷: 2026-09-28 · 원본 DB 와 md5 대조 완료 (verify.sql)

create or replace view public.goal_progress with (security_invoker=true) as
 WITH latest_month AS (
         SELECT asset_snapshots.owner_id,
            max(asset_snapshots.month) AS month
           FROM asset_snapshots
          GROUP BY asset_snapshots.owner_id
        ), snap AS (
         SELECT s.id,
            s.owner_id,
            s.month,
            s.asset_class,
            s.account,
            s.amount,
            s.created_at
           FROM asset_snapshots s
             JOIN latest_month m ON m.owner_id = s.owner_id AND m.month = s.month
        ), asset_now AS (
         SELECT snap.owner_id,
            sum(snap.amount) AS total_asset,
            sum(snap.amount) FILTER (WHERE snap.asset_class <> '연금 자산'::text) AS available_asset
           FROM snap
          GROUP BY snap.owner_id
        ), spend_this_month AS (
         SELECT t.owner_id,
            sum(t.amount) FILTER (WHERE c.kind = '지출'::text) AS monthly_expense,
            sum(t.amount) FILTER (WHERE c.kind = '지출'::text AND t.is_fixed) AS fixed_cost
           FROM transactions t
             JOIN categories c ON c.id = t.category_id
          WHERE t.company_paid IS NOT TRUE AND date_trunc('month'::text, t.date::timestamp with time zone) = date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)
          GROUP BY t.owner_id
        ), income_this_year AS (
         SELECT t.owner_id,
            sum(t.amount) AS invest_income
           FROM transactions t
             JOIN categories c ON c.id = t.category_id
          WHERE c.kind = '수입'::text AND c.category ~~ '%투자%'::text AND date_trunc('year'::text, t.date::timestamp with time zone) = date_trunc('year'::text, CURRENT_DATE::timestamp with time zone)
          GROUP BY t.owner_id
        ), max_weight AS (
         SELECT h.owner_id,
            max(h.weight) AS position_max_ratio
           FROM holdings h
          WHERE h.snapshot_at = (( SELECT max(h2.snapshot_at) AS max
                   FROM holdings h2
                  WHERE h2.owner_id = h.owner_id))
          GROUP BY h.owner_id
        ), resolved AS (
         SELECT g.id,
            g.owner_id,
            g.period,
            g.kind,
            g.item,
            g.frequency,
            g.target_amount,
            g.target_ratio,
            g.status,
            g.achieved_on,
            g.note,
            g.created_at,
            g.categories,
            g.target_on,
            g.is_bucketlist,
            g.current_value,
            g.target_value,
            g.unit,
            g.metric_source,
            g.metric_params,
            g."position",
            g.notion_id,
            g.updated_at,
            g.emoji,
                CASE g.metric_source
                    WHEN 'total_asset'::text THEN a.total_asset
                    WHEN 'available_asset'::text THEN a.available_asset
                    WHEN 'monthly_expense'::text THEN s.monthly_expense
                    WHEN 'fixed_cost'::text THEN s.fixed_cost
                    WHEN 'invest_income'::text THEN i.invest_income
                    WHEN 'position_max_ratio'::text THEN w.position_max_ratio
                    WHEN 'asset_class'::text THEN ( SELECT sum(sn.amount) AS sum
                       FROM snap sn
                      WHERE sn.owner_id = g.owner_id AND (g.metric_params ? 'asset_class'::text AND sn.asset_class = (g.metric_params ->> 'asset_class'::text) OR g.metric_params ? 'accounts'::text AND (sn.account IN ( SELECT jsonb_array_elements_text(g.metric_params -> 'accounts'::text) AS jsonb_array_elements_text))))
                    WHEN 'media_count'::text THEN ( SELECT count(*)::numeric AS count
                       FROM media_items mi
                      WHERE mi.owner_id = g.owner_id AND mi.status = 'done'::text AND (NOT g.metric_params ? 'kinds'::text OR (mi.kind IN ( SELECT jsonb_array_elements_text(g.metric_params -> 'kinds'::text) AS jsonb_array_elements_text))) AND (NOT g.metric_params ? 'year'::text OR mi.finished_on IS NOT NULL AND EXTRACT(year FROM mi.finished_on)::integer =
                            CASE
                                WHEN (g.metric_params ->> 'year'::text) = 'target_on'::text THEN EXTRACT(year FROM g.target_on)::integer
                                ELSE NULLIF(g.metric_params ->> 'year'::text, ''::text)::integer
                            END))
                    ELSE g.current_value
                END AS cur,
            COALESCE(g.target_amount, g.target_ratio, g.target_value) AS tgt
           FROM goals g
             LEFT JOIN asset_now a ON a.owner_id = g.owner_id
             LEFT JOIN spend_this_month s ON s.owner_id = g.owner_id
             LEFT JOIN income_this_year i ON i.owner_id = g.owner_id
             LEFT JOIN max_weight w ON w.owner_id = g.owner_id
        )
 SELECT id,
    owner_id,
    item,
    emoji,
    categories,
    status,
    metric_source,
    tgt AS target,
    cur AS current,
        CASE
            WHEN tgt IS NULL OR tgt = 0::numeric THEN NULL::numeric
            ELSE round(cur / tgt * 100::numeric, 1)
        END AS progress_pct,
    metric_source = ANY (ARRAY['monthly_expense'::text, 'fixed_cost'::text, 'position_max_ratio'::text]) AS lower_is_better,
    kind,
    period,
    unit,
    note,
    target_on,
    achieved_on,
    is_bucketlist,
    notion_id,
    target_amount,
    target_ratio,
    current_value,
    target_value,
    frequency,
    "position",
    updated_at,
    metric_params
   FROM resolved;

create or replace view public.life_event_view with (security_invoker=on) as
 SELECT e.id,
    e.owner_id,
    e.title,
    e.kind,
    e.weight,
    e.happened_on,
    e.happened_end,
    e."precision",
    e.place,
    e.summary,
    e.note,
    e.cover_url,
    e.tags,
    e.era,
    e.goal_id,
    e.position_id,
    e.group_id,
    e.notion_id,
    e.created_at,
    COALESCE(( SELECT array_agg(p.name ORDER BY p.name) AS array_agg
           FROM life_event_people ep
             JOIN life_people p ON p.id = ep.person_id
          WHERE ep.event_id = e.id), '{}'::text[]) AS people,
    g.item AS goal_item,
    g.emoji AS goal_emoji,
    cp.company AS position_company,
    lg.name AS group_name,
    lg.emoji AS group_emoji
   FROM life_events e
     LEFT JOIN goals g ON g.id = e.goal_id
     LEFT JOIN career_positions cp ON cp.id = e.position_id
     LEFT JOIN life_groups lg ON lg.id = e.group_id;

create or replace view public.life_group_view with (security_invoker=on) as
 SELECT id,
    owner_id,
    name,
    emoji,
    note,
    started_on,
    ended_on,
    tags,
    created_at,
    COALESCE(( SELECT array_agg(p.name ORDER BY p.name) AS array_agg
           FROM life_group_people gp
             JOIN life_people p ON p.id = gp.person_id
          WHERE gp.group_id = g.id), '{}'::text[]) AS members,
    ( SELECT count(*) AS count
           FROM life_events e
          WHERE e.group_id = g.id) AS event_count
   FROM life_groups g;

create or replace view public.media_view with (security_invoker=true) as
 SELECT id,
    owner_id,
    title,
    original_title,
    kind,
    status,
    rating,
    release_year,
    started_on,
    finished_on,
    times,
    is_lifetime,
    amateur_pro,
    one_liner,
    note,
    notion_id,
    cover_url,
    COALESCE(( SELECT array_agg(t.name ORDER BY t.name) AS array_agg
           FROM media_tags mt
             JOIN tags t ON t.id = mt.tag_id
          WHERE mt.media_id = m.id), '{}'::text[]) AS tags,
    COALESCE(( SELECT array_agg(c.name ORDER BY c.name) AS array_agg
           FROM media_countries mc
             JOIN countries c ON c.id = mc.country_id
          WHERE mc.media_id = m.id), '{}'::text[]) AS countries,
    COALESCE(( SELECT array_agg(DISTINCT p.name ORDER BY p.name) AS array_agg
           FROM media_credits mc
             JOIN people p ON p.id = mc.person_id
          WHERE mc.media_id = m.id AND (mc.role = ANY (ARRAY['주창작'::text, '참여'::text]))), '{}'::text[]) AS creators,
    COALESCE(( SELECT array_agg(DISTINCT p.name ORDER BY p.name) AS array_agg
           FROM media_credits mc
             JOIN people p ON p.id = mc.person_id
          WHERE mc.media_id = m.id AND mc.role = '출연'::text), '{}'::text[]) AS cast_members,
    COALESCE(( SELECT array_agg(DISTINCT p.name ORDER BY p.name) AS array_agg
           FROM media_credits mc
             JOIN people p ON p.id = mc.person_id
          WHERE mc.media_id = m.id AND mc.role = '제작'::text), '{}'::text[]) AS orgs,
    COALESCE(( SELECT array_agg(p.name || COALESCE(' · '::text || mc.role_detail, ''::text) ORDER BY mc.role, p.name) AS array_agg
           FROM media_credits mc
             JOIN people p ON p.id = mc.person_id
          WHERE mc.media_id = m.id), '{}'::text[]) AS credits_detail,
    COALESCE(( SELECT array_agg(DISTINCT p.name ORDER BY p.name) AS array_agg
           FROM media_credits mc
             JOIN people p ON p.id = mc.person_id
          WHERE mc.media_id = m.id AND mc.role <> '주창작'::text), '{}'::text[]) AS cast_crew,
    series_id,
    series_pos
   FROM media_items m;

create or replace view public.v_transactions with (security_invoker=true) as
 SELECT t.id,
    t.owner_id,
    t.date,
    c.kind,
    c.category,
    c.subcategory,
    c.emoji_kind,
    c.emoji_category,
    t.amount,
    t.merchant_group,
    t.merchant,
    t.note,
    t.good_bad,
    t.company_paid,
    t.is_fixed,
    t.category_id,
    t.created_at,
    t.updated_at
   FROM transactions t
     JOIN categories c ON c.id = t.category_id;
