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
- Messages appear as module-local barrage text in this format: `@用户名：留言`.
- Each submission produces at most one barrage message, even when the submission selects multiple players.

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

Notes:

- No update or delete policy is created, so normal authenticated users cannot change or remove a submitted vote.
- The unique constraint on `(account_id, vote_date, tour)` prevents duplicate same-day submissions.
- The select policy lets a logged-in user read that date/tour's results only after they have submitted that same date/tour.
- The frontend still hides results before submission, but the database policy is the real guardrail.

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

Cleanup SQL for the 2026-05-24 test account:

```sql
delete from auth.users
where id in (
  select id
  from public.profiles
  where display_name = 'codexjinx1779608621416'
);
```
