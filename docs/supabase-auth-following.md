# Supabase Auth And Following

This document records the setup for the first logged-in feature: following survivor users from the live pick table.

## Product Rules

- Existing site modules remain readable without login.
- Login/register is only prompted when a visitor tries to follow a user, open the following filter, or use the account entry.
- Login UI uses custom nickname + password.
- Nickname is required, can contain Chinese, English, and special characters, and must be unique.
- Following is cross-tour: once a survivor user is followed, the star is active wherever the same `user_id` appears in ATP or WTA data.
- Followed users are shown with a yellow star.
- The live pick, breakdown, and preference toolbars include a `关注用户` filter.

## Auth Approach

Supabase Auth is email/password based, while the product UI uses nickname/password.

The frontend converts the normalized nickname to an internal pseudo email:

```text
u-{sha256(nickname)}@users.tennis-survivor.local
```

Users never see this pseudo email. This allows the site to keep a nickname/password UI while still using Supabase Auth sessions, password handling, and RLS.

Important limitations:

- Disable email confirmation for this first version, because these pseudo emails cannot receive mail.
- Password reset is not available in the first version unless a real email flow is added later.
- Treat the nickname as the login identifier. Users should remember it.

## Frontend Config

Fill these constants in `index.html` after creating the Supabase project:

```js
const SUPABASE_URL='https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY='YOUR_SUPABASE_PUBLISHABLE_OR_ANON_PUBLIC_KEY';
```

The publishable key, or legacy anon public key, is safe to expose in the static frontend when RLS policies are configured correctly. Never expose a `service_role` key or secret key in `index.html`.

## Create A Supabase Project

Official entry:

- https://supabase.com/dashboard
- API key docs: https://supabase.com/docs/guides/getting-started/api-keys
- Auth password docs: https://supabase.com/docs/guides/auth/passwords
- Auth general configuration: https://supabase.com/docs/guides/auth/general-configuration

Steps:

1. Sign in to the Supabase dashboard.
2. Create a new project.
3. Choose an organization, project name, database password, and region.
4. Prefer an Asia region if most users are in China/Asia, while accepting that GitHub Pages and Supabase still cross public networks.
5. Wait for the project to finish provisioning.
6. Open the project dashboard.
7. Find the project URL and publishable key, or legacy anon public key, from the Connect dialog or `Settings > API Keys`.
8. Put the project URL and publishable/anon public key into `index.html`.
9. Go to `Authentication > Sign In / Providers > Email`.
10. Enable Email provider and disable Confirm email for the nickname/password first version.
11. Run the SQL schema and RLS policies below in SQL Editor.

Common dashboard naming notes:

- The Data API page may show an `API URL` like `https://PROJECT_REF.supabase.co/rest/v1/`.
- For `SUPABASE_URL`, use only the root project URL: `https://PROJECT_REF.supabase.co`.
- Do not include `/rest/v1/` in `SUPABASE_URL`.
- The browser-safe key is labeled `publishable`, `Publishable key`, or legacy `anon public` / `anon`.
- A publishable key may start with `sb_publishable_`; a legacy anon key may be a long JWT and is usually labeled `anon`.
- Never put a key labeled `service_role`, `secret`, or starting with `sb_secret_` into frontend code.

## Cost Notes

Checked against official Supabase docs on 2026-05-24:

- The Free Plan has limited free quotas and is enough for first-version validation of the following-users feature.
- Current documented Free Plan quotas include 2 free projects, 500 MB database size per project, 5 GB egress, and 50,000 monthly active users.
- MAU means distinct users who log in or refresh a token during a billing cycle; repeated logins by the same user in the same cycle count once.
- MAU overage is only charged beyond the plan quota; Free Plan over-quota behavior should be monitored from the Supabase usage page.
- Upgrade only if the project needs higher quotas, no project pausing, production stability, or paid add-ons.
- Always re-check https://supabase.com/pricing before production launch because cloud pricing can change.

## Supabase Auth Settings

In Supabase Dashboard:

- Enable Email provider.
- Disable email confirmations for the first version.
- Keep minimum password length at 6 or higher.
- Add the GitHub Pages URL and local preview URL to allowed redirect URLs if future OAuth or magic-link flows are added.

## SQL Schema

Run this in the Supabase SQL editor.

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_follows (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  followed_user_id text not null,
  followed_username_snapshot text not null,
  created_at timestamptz not null default now(),
  unique (account_id, followed_user_id)
);

alter table public.profiles enable row level security;
alter table public.user_follows enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "follows_select_own" on public.user_follows;
drop policy if exists "follows_insert_own" on public.user_follows;
drop policy if exists "follows_delete_own" on public.user_follows;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "follows_select_own"
on public.user_follows
for select
to authenticated
using ((select auth.uid()) = account_id);

create policy "follows_insert_own"
on public.user_follows
for insert
to authenticated
with check ((select auth.uid()) = account_id);

create policy "follows_delete_own"
on public.user_follows
for delete
to authenticated
using ((select auth.uid()) = account_id);
```

Optional trigger to create `profiles` automatically from Supabase Auth metadata:

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
```

## Validation Checklist

- Visitor can load ATP/WTA live pick tables without logging in.
- Clicking a star while logged out opens the login modal.
- Registering a new nickname succeeds and follows the originally clicked user.
- Registering the same nickname twice fails.
- A logged-in user can add and remove follows.
- Followed stars remain yellow after refresh.
- `关注用户` filter only shows followed survivor users.
- Following one `user_id` marks the same survivor user in ATP and WTA if present.
- RLS prevents reading or changing another account's follows.

## Local Validation

2026-05-24:

- Supabase URL and publishable key were filled into `index.html`.
- Email provider was enabled and Confirm email was disabled.
- SQL schema and RLS policies were executed successfully in Supabase.
- Local preview verified registration, duplicate nickname blocking, login, add follow, follow persistence after refresh, following filter, and remove follow.
- Cross-module validation verified that the same followed `user_id` appears as a yellow star and can be filtered in live picks, breakdown, and preference tables.
