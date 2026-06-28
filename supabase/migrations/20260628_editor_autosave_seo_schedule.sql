alter table public.posts add column if not exists publish_at timestamptz;
alter table public.posts add column if not exists seo_description text;
alter table public.posts add column if not exists social_title text;
alter table public.posts add column if not exists social_description text;
alter table public.posts add column if not exists social_image_url text;
alter table public.posts add column if not exists autosave_payload jsonb;
alter table public.posts add column if not exists autosaved_at timestamptz;

update public.posts
set publish_at = published_at
where publish_at is null
  and published_at is not null;

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
where p.status in ('published', 'scheduled')
  and coalesce(p.publish_at, p.published_at) <= now()
group by p.id;

drop policy if exists "Public can read published posts" on public.posts;
create policy "Public can read published posts" on public.posts
for select to anon, authenticated
using (status in ('published', 'scheduled') and coalesce(publish_at, published_at) <= now());

drop policy if exists "Public can read categories" on public.categories;
create policy "Public can read categories" on public.categories
for select to anon, authenticated
using (
  exists (
    select 1
    from public.post_categories pc
    join public.posts p on p.id = pc.post_id
    where pc.category_id = categories.id
      and p.status in ('published', 'scheduled')
      and coalesce(p.publish_at, p.published_at) <= now()
  )
);

drop policy if exists "Public can read tags" on public.tags;
create policy "Public can read tags" on public.tags
for select to anon, authenticated
using (
  exists (
    select 1
    from public.post_tags pt
    join public.posts p on p.id = pt.post_id
    where pt.tag_id = tags.id
      and p.status in ('published', 'scheduled')
      and coalesce(p.publish_at, p.published_at) <= now()
  )
);

drop policy if exists "Public can read post categories" on public.post_categories;
create policy "Public can read post categories" on public.post_categories
for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_id and p.status in ('published', 'scheduled') and coalesce(p.publish_at, p.published_at) <= now()));

drop policy if exists "Public can read post tags" on public.post_tags;
create policy "Public can read post tags" on public.post_tags
for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_id and p.status in ('published', 'scheduled') and coalesce(p.publish_at, p.published_at) <= now()));
