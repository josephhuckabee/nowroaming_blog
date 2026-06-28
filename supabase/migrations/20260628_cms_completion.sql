alter table public.posts add column if not exists body_markdown text;
alter table public.posts add column if not exists gallery jsonb not null default '[]'::jsonb;
alter table public.posts add column if not exists related_post_ids uuid[] not null default '{}'::uuid[];
alter table public.media add column if not exists responsive_variants jsonb not null default '[]'::jsonb;

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

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  location_name text not null,
  latitude numeric not null,
  longitude numeric not null,
  visited_at date not null,
  cover_image_url text,
  journal_note text,
  related_post_slug text,
  is_public boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.routes enable row level security;
alter table public.checkins enable row level security;

drop policy if exists "Admins can manage routes" on public.routes;
create policy "Admins can manage routes" on public.routes
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

drop policy if exists "Public can read published routes" on public.routes;
create policy "Public can read published routes" on public.routes
for select to anon, authenticated
using (status = 'published');

drop policy if exists "Admins can manage checkins" on public.checkins;
create policy "Admins can manage checkins" on public.checkins
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

drop policy if exists "Public can read public checkins" on public.checkins;
create policy "Public can read public checkins" on public.checkins
for select to anon, authenticated
using (is_public = true);

drop trigger if exists routes_touch_updated_at on public.routes;
create trigger routes_touch_updated_at
before update on public.routes
for each row execute function public.touch_updated_at();

drop trigger if exists checkins_touch_updated_at on public.checkins;
create trigger checkins_touch_updated_at
before update on public.checkins
for each row execute function public.touch_updated_at();
