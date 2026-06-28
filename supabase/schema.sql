create extension if not exists pgcrypto;

create type public.post_status as enum ('draft', 'published', 'scheduled');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'author' check (role in ('admin', 'author')),
  created_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  subtitle text,
  excerpt text,
  body_html text not null default '',
  author text not null default 'Joseph Huckabee',
  status public.post_status not null default 'draft',
  published_at timestamptz,
  scheduled_for timestamptz,
  featured_image_url text,
  og_image_url text,
  canonical_url text,
  seo_title text,
  meta_description text,
  reading_time_minutes integer not null default 1,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(subtitle, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body_html, '')), 'C')
  ) stored,
  constraint published_posts_have_date check (status <> 'published' or published_at is not null)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.post_categories (
  post_id uuid not null references public.posts(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (post_id, category_id)
);

create table public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (post_id, tag_id)
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'media',
  path text not null unique,
  url text not null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  is_public boolean not null default false,
  alt_text text,
  folder text,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.settings (
  id integer primary key default 1 check (id = 1),
  blog_title text,
  blog_description text,
  hero_text text,
  social_links jsonb not null default '{}'::jsonb,
  profile_image_url text,
  author_name text,
  author_bio text,
  seo_defaults jsonb not null default '{}'::jsonb,
  analytics_ids jsonb not null default '{}'::jsonb,
  contact_info text,
  updated_at timestamptz not null default now()
);

create index posts_status_published_idx on public.posts(status, published_at desc);
create index posts_search_idx on public.posts using gin(search_vector);
create index media_name_idx on public.media using gin(to_tsvector('english', name));

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger posts_touch_updated_at
before update on public.posts
for each row execute function public.touch_updated_at();

create trigger settings_touch_updated_at
before update on public.settings
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email), 'author')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace view public.published_posts
with (security_invoker = true) as
select
  p.*,
  coalesce(
    jsonb_agg(distinct jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug))
      filter (where c.id is not null),
    '[]'::jsonb
  ) as categories,
  coalesce(
    jsonb_agg(distinct jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug))
      filter (where t.id is not null),
    '[]'::jsonb
  ) as tags
from public.posts p
left join public.post_categories pc on pc.post_id = p.id
left join public.categories c on c.id = pc.category_id
left join public.post_tags pt on pt.post_id = p.id
left join public.tags t on t.id = pt.tag_id
where p.status = 'published'
  and p.published_at <= now()
group by p.id;

alter table public.users enable row level security;
alter table public.posts enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.post_categories enable row level security;
alter table public.post_tags enable row level security;
alter table public.media enable row level security;
alter table public.settings enable row level security;

create policy "Admins can read own profile" on public.users
for select to authenticated
using (auth.uid() = id);

create policy "Admins can manage posts" on public.posts
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Public can read published posts" on public.posts
for select to anon, authenticated
using (status = 'published' and published_at <= now());

create policy "Admins can manage categories" on public.categories
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Public can read categories" on public.categories
for select to anon, authenticated
using (true);

create policy "Admins can manage tags" on public.tags
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Public can read tags" on public.tags
for select to anon, authenticated
using (true);

create policy "Admins can manage post categories" on public.post_categories
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Public can read post categories" on public.post_categories
for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_id and p.status = 'published' and p.published_at <= now()));

create policy "Admins can manage post tags" on public.post_tags
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Public can read post tags" on public.post_tags
for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_id and p.status = 'published' and p.published_at <= now()));

create policy "Admins can manage media rows" on public.media
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Public can read published media rows" on public.media
for select to anon, authenticated
using (is_public = true);

create policy "Admins can manage settings" on public.settings
for all to authenticated
using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Public can read settings" on public.settings
for select to anon, authenticated
using (true);

insert into public.settings (id, blog_title, blog_description, author_name)
values (1, 'Now Roaming', 'It''s good to be lost.', 'Joseph Huckabee')
on conflict (id) do nothing;

create or replace function public.refresh_media_public_flags()
returns void
language sql
security definer
set search_path = public
as $$
  update public.media m
  set is_public = exists (
    select 1
    from public.posts p
    where p.status = 'published'
      and p.published_at <= now()
      and (
        p.featured_image_url = m.url
        or p.og_image_url = m.url
        or p.body_html ilike '%' || m.url || '%'
        or p.attachments::text ilike '%' || m.url || '%'
      )
  );
$$;

grant execute on function public.refresh_media_public_flags() to authenticated;

-- Storage setup:
-- 1. Create a bucket named "media" in Supabase Storage.
-- 2. Add storage policies below after the bucket exists.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can read published media objects" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'media'
  and exists (
    select 1
    from public.media m
    where m.path = storage.objects.name
      and m.is_public = true
  )
);

create policy "Admins can read media objects" on storage.objects
for select to authenticated
using (
  bucket_id = 'media'
  and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create policy "Admins can upload media objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'media'
  and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create policy "Admins can update media objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'media'
  and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
)
with check (
  bucket_id = 'media'
  and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create policy "Admins can delete media objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'media'
  and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
