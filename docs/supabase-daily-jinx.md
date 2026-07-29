# Supabase Daily Jinx

This document records the setup for the `每日毒奶` voting module.

## Product Rules

- Existing site modules remain readable without login.
- Visitors can open `每日毒奶` and see the voting form without login.
- Submitting a vote requires login through the existing nickname/password account system.
- The module has ATP and WTA views.
- The question is `今天你最希望谁出局？`.
- Candidate players come from `data/current.json` `today_pool`, limited to today's singles main-draw schedule.
- Candidate players are displayed by Chinese-name pinyin order from A to Z.
- Each logged-in account can submit at most once per date and tour.
- After submitting, the vote cannot be changed on the same day.
- Each submission can select 1 to 3 players.
- Each submission must include one message, up to 50 characters.
- Results are visible only after the logged-in account has submitted that date and tour.
- After submitting, the result status line shows the current account's real selected players, for example `你今日的毒奶球员为：丰塞卡，布洛克斯`.
- Messages appear as module-local barrage text in this format: `@用户名：留言`.
- Each submission produces at most one barrage message, even when the submission selects multiple players.
- Barrage messages run through same-speed lane queues, loop continuously, and restart after page visibility changes to avoid browser-throttling pileups.
- The `毒奶榜` view shows ATP and WTA leaderboards side by side.
- Leaderboard scoring is aggregate-only: if a Daily Jinx submission was created before the selected player's match started, the player really loses, and that player had `x` picks in the survivor live-pick player statistics on that date/tour, every Daily Jinx user who selected that player gets `x` points.
- Canceled, postponed, unstarted, and unfinished matches do not create scoring settlements.
- Leaderboard scores are cumulative across all settled vote dates; each daily settlement adds yesterday's newly hit points to the user's historical total.
- Phone-like account nicknames are masked on the frontend before display, for example `15804031803` becomes `158****1803`.
- Live-pick player-count snapshots are generated into `data/daily_jinx_pick_counts.json` by `scripts/fetch_current.py`.
- Match-loss settlements, including each loser's `pick_count` and match start time, are generated into `data/daily_jinx_settlements.json` by `scripts/fetch_daily_jinx_settlements.py`; raw vote rows remain protected by RLS.
- The browser never downloads or uploads the lifetime settlement history. `Update Daily Data` incrementally settles refreshed dates into a private score ledger and publishes the small `data/daily_jinx_leaderboard.json` display cache.
- The leaderboard cache includes public equipped-badge fields, is prefetched on page entry, and is stored locally for stale-while-revalidate display.

## SQL Schema And RLS

Run this in the Supabase SQL editor.

```sql
create table if not exists public.daily_jinx_votes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  voter_name_snapshot text not null,
  vote_date date not null,
  tour text not null check (tour in ('ATP', 'WTA')),
  event_id text not null default '',
  event_name text not null default '',
  selected_players text[] not null,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, vote_date, tour),
  check (cardinality(selected_players) between 1 and 3),
  check (array_position(selected_players, null) is null),
  check (char_length(btrim(message)) between 1 and 50)
);

alter table public.daily_jinx_votes enable row level security;

drop policy if exists "daily_jinx_select_after_submit" on public.daily_jinx_votes;
drop policy if exists "daily_jinx_insert_own" on public.daily_jinx_votes;
drop policy if exists "daily_jinx_update_none" on public.daily_jinx_votes;
drop policy if exists "daily_jinx_delete_none" on public.daily_jinx_votes;

create or replace function public.has_daily_jinx_submission(
  p_vote_date date,
  p_tour text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.daily_jinx_votes v
    where v.account_id = (select auth.uid())
      and v.vote_date = p_vote_date
      and v.tour = p_tour
  );
$$;

revoke all on function public.has_daily_jinx_submission(date, text) from public;
grant execute on function public.has_daily_jinx_submission(date, text) to authenticated;

create policy "daily_jinx_select_after_submit"
on public.daily_jinx_votes
for select
to authenticated
using (public.has_daily_jinx_submission(vote_date, tour));

create policy "daily_jinx_insert_own"
on public.daily_jinx_votes
for insert
to authenticated
with check ((select auth.uid()) = account_id);

grant select, insert on public.daily_jinx_votes to authenticated;
```

Legacy on-demand leaderboard RPC (kept for compatibility; the production
frontend no longer calls it):

```sql
create or replace function public.daily_jinx_leaderboard(p_settlements jsonb)
returns table (
  tour text,
  display_name text,
  score integer,
  hit_count integer,
  scored_days integer
)
language sql
security definer
set search_path = public
stable
as $$
  with settlements as (
    select distinct
      s.vote_date,
      s.tour,
      coalesce(s.event_id, '') as event_id,
      btrim(s.player_name) as player_name,
      greatest(coalesce(s.pick_count, 0), 0)::integer as pick_count,
      s.match_start_at
    from jsonb_to_recordset(coalesce(p_settlements, '[]'::jsonb))
      as s(
        vote_date date,
        tour text,
        event_id text,
        player_name text,
        pick_count integer,
        match_start_at timestamptz
      )
    where s.vote_date is not null
      and s.tour in ('ATP', 'WTA')
      and btrim(s.player_name) <> ''
      and s.match_start_at is not null
  ),
  vote_picks as (
    select distinct
      v.id,
      v.account_id,
      v.vote_date,
      v.tour,
      coalesce(v.event_id, '') as event_id,
      btrim(p.player_name) as player_name,
      v.created_at
    from public.daily_jinx_votes v
    cross join lateral unnest(v.selected_players) as p(player_name)
    where btrim(p.player_name) <> ''
  ),
  hits as (
    select
      vp.*,
      s.pick_count
    from vote_picks vp
    join settlements s
      on s.vote_date = vp.vote_date
     and s.tour = vp.tour
     and (s.event_id = '' or s.event_id = vp.event_id)
     and s.player_name = vp.player_name
     and s.pick_count > 0
     and vp.created_at < s.match_start_at
  ),
  latest_names as (
    select distinct on (v.account_id)
      v.account_id,
      v.voter_name_snapshot
    from public.daily_jinx_votes v
    order by v.account_id, v.created_at desc
  )
  select
    h.tour,
    coalesce(nullif(ln.voter_name_snapshot, ''), '匿名炉友') as display_name,
    sum(h.pick_count)::integer as score,
    count(*)::integer as hit_count,
    count(distinct h.vote_date)::integer as scored_days
  from hits h
  left join latest_names ln on ln.account_id = h.account_id
  group by h.tour, h.account_id, ln.voter_name_snapshot
  order by h.tour, score desc, hit_count desc, display_name asc;
$$;

revoke all on function public.daily_jinx_leaderboard(jsonb) from public;
grant execute on function public.daily_jinx_leaderboard(jsonb) to anon, authenticated;
```

## Incremental Production Leaderboard

Run
`supabase/migrations/202607290002_daily_jinx_incremental_leaderboard.sql`
once. It creates:

- `daily_jinx_score_ledger`: one idempotent row per vote/settlement hit.
- `daily_jinx_leaderboard_cache`: the current ATP/WTA aggregate.
- `daily_jinx_refresh_leaderboard(jsonb,date[],boolean)`: a service-role-only
  refresh RPC.

The first `Update Daily Data` execution performs a complete historical
backfill. Later executions use `refreshed_dates` from
`daily_jinx_settlements.json`, delete/recalculate only those authoritative
dates, and therefore support result corrections without double-awarding
points.

The workflow runs:

1. `fetch_daily_jinx_settlements.py`
2. `update_daily_jinx_leaderboard.mjs`
3. `build_data_manifest.py`

The repository must already contain `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` Actions secrets. A database/cache failure stops the
workflow before the static data commit, so a partial leaderboard is never
published.

Notes:

- No update or delete policy is created, so normal authenticated users cannot change or remove a submitted vote.
- The unique constraint on `(account_id, vote_date, tour)` prevents duplicate same-day submissions.
- The select policy lets a logged-in user read that date/tour's results only after they have submitted that same date/tour.
- The frontend inserts into `daily_jinx_votes` without requesting returned rows; requesting an inserted row would add an unnecessary select/returning permission check and can fail under RLS.
- The frontend still hides results before submission, but the database policy is the real guardrail.
- The leaderboard RPC returns only aggregate nickname/score data. It does not expose raw vote messages, selected-player arrays, or account ids.
- The `pick_count` used by the leaderboard is the survivor live-pick player count from the static settlement payload, not the number of Daily Jinx users who voted for that player.
- A vote scores only if its `created_at` is earlier than the selected player's `match_start_at` in the settlement payload.

## Validation Checklist

- Logged-out visitor can open `每日毒奶`.
- Logged-out visitor sees ATP/WTA candidates but cannot submit without logging in.
- Logged-in user can select 1 to 3 players and submit a message up to 50 characters.
- Submitting with 0 players, more than 3 players, or an empty/too-long message fails.
- After submitting, the user can see total participants, vote counts, vote percentages, and barrage messages.
- Barrage messages include the username snapshot, for example `@test111：王曦雨今天必出局`.
- A submission with multiple selected players still renders only one barrage message.
- Refreshing after submission still shows results.
- A second submission for the same date and tour fails and the UI says the vote cannot be changed.
- ATP and WTA submissions are independent.
- A user who has not submitted that date/tour cannot read that date/tour's rows through the public client.

## 2026-05-24 Validation

Local preview was tested against the live Supabase project after the SQL above was executed successfully.

Verified:

- Logged-out submit opens the account modal and shows the daily-jinx login reason.
- A new nickname/password test account can register and submit an ATP vote.
- After submission, the ATP view hides the form and shows participant count, player vote counts, percentages, and module-local barrage messages.
- Barrage messages include the username snapshot, for example `@codexjinx1779608621416：codex test vote`.
- Refreshing the page preserves the logged-in submitted state and still shows the ATP result view.
- WTA remains an unsubmitted form for the same account, confirming ATP/WTA submissions are independent.
- The `daily_jinx_leaderboard(jsonb)` RPC was created successfully and appears in `pg_proc`.
- Local preview can open `毒奶榜` without the missing-RPC error; with no settled matches yet, it shows the expected empty leaderboard state.

Cleanup SQL for the 2026-05-24 test account:

```sql
delete from auth.users
where id in (
  select id
  from public.profiles
  where display_name = 'codexjinx1779608621416'
);
```
