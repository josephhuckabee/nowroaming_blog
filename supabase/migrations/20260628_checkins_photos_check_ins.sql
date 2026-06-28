alter table public.posts add column if not exists publish_at timestamptz;
alter table public.posts add column if not exists seo_description text;
alter table public.posts add column if not exists social_image_url text;
alter table public.posts add column if not exists social_title text;
alter table public.posts add column if not exists social_description text;
alter table public.posts add column if not exists gallery jsonb not null default '[]'::jsonb;
alter table public.posts add column if not exists related_post_ids uuid[] not null default '{}'::uuid[];
alter table public.posts add column if not exists autosave_payload jsonb;
alter table public.posts add column if not exists autosaved_at timestamptz;

update public.posts
set publish_at = published_at
where publish_at is null
  and published_at is not null;

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  location_name text not null,
  latitude numeric not null,
  longitude numeric not null,
  visited_at date not null default current_date,
  cover_image_url text,
  photos jsonb not null default '[]'::jsonb,
  journal_note text,
  related_post_slug text,
  is_public boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  cover_image_url text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.check_ins enable row level security;
alter table public.routes enable row level security;

drop policy if exists "Admins can manage check_ins" on public.check_ins;
create policy "Admins can manage check_ins" on public.check_ins
for all
using (exists (select 1 from public.users where users.id = auth.uid() and users.role = 'admin'))
with check (exists (select 1 from public.users where users.id = auth.uid() and users.role = 'admin'));

drop policy if exists "Public can read public check_ins" on public.check_ins;
create policy "Public can read public check_ins" on public.check_ins
for select
using (is_public = true);

drop policy if exists "Admins can manage routes" on public.routes;
create policy "Admins can manage routes" on public.routes
for all
using (exists (select 1 from public.users where users.id = auth.uid() and users.role = 'admin'))
with check (exists (select 1 from public.users where users.id = auth.uid() and users.role = 'admin'));

drop policy if exists "Public can read published routes" on public.routes;
create policy "Public can read published routes" on public.routes
for select
using (status = 'published');
