# Now Roaming Browser CMS

Now Roaming is still an Eleventy site, but new blog content is managed entirely from the browser and stored in Supabase. You do not need VS Code, Markdown files, Git commits, or manual file editing to publish new posts.

Legacy Markdown posts can stay in `posts/`. All new posts should be created in the CMS and saved to Supabase.

## Routes

- `/admin/login/` - private CMS login
- `/admin/` - admin dashboard
- `/admin/posts/` - post list, search, filters, sorting
- `/admin/drafts/` - draft-only post queue
- `/admin/posts/new/` - create a post
- `/admin/posts/:id/edit/` - edit a post on Vercel
- `/admin/posts/edit/?id=:id` - local Eleventy dev fallback for editing
- `/admin/categories/` - category CRUD
- `/admin/tags/` - tag CRUD
- `/admin/media/` - media library and uploads
- `/admin/routes/` - route CRUD
- `/admin/check-ins/` - map check-in CRUD
- `/admin/settings/` - blog settings
- `/map/` - public map with public check-ins
- `/blog/` - public Supabase-backed post list
- `/blog/:slug` - public Supabase-backed post reader on Vercel

## Files Added

- `.env.example`
- `.gitignore`
- `_data/cms.js`
- `admin/index.html`
- `admin/login.html`
- `admin/editor.html`
- `admin/media.html`
- `admin/settings.html`
- `admin/posts/index.html`
- `admin/posts/new.html`
- `admin/posts/edit.html`
- `blog/index.html`
- `blog/post.html`
- `docs/CMS.md`
- `js/cms-admin.js`
- `js/cms-public.js`
- `js/supabase-client.js`
- `rss.xml.njk`
- `supabase/schema.sql`
- `vercel.json`

## Files Modified

- `.eleventy.js`
- `.eleventyignore`
- `_includes/layouts/base.njk`
- `css/styles.css`
- `robots.txt.njk`
- `sitemap.xml.njk`

## Environment Variables

Create `.env` locally and add the same values in Vercel:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-public-anon-key
ADMIN_EMAIL=you@example.com
SITE_URL=https://youarenowroaming.com
```

Never add the Supabase service role key to this project. In Vercel, `SUPABASE_ANON_KEY` must be the value from Supabase Project Settings > API > `anon public`. If you put the `service_role` key in `SUPABASE_ANON_KEY`, Supabase will reject browser auth with “Forbidden use of secret API key in browser.” The build now fails if it detects a service role key.

Do not create a `SUPABASE_SERVICE_ROLE_KEY` environment variable for this static Eleventy app. There is no server-side admin API in this project that needs it.

## Supabase Tables

The schema in `supabase/schema.sql` creates:

- `users`
- `posts`
- `categories`
- `tags`
- `post_categories`
- `post_tags`
- `media`
- `routes`
- `checkins`
- `settings`
- `published_posts` view

It also creates `refresh_media_public_flags()`, which marks uploaded media public only when referenced by a currently published post.

## Supabase Storage

The schema creates or updates one bucket:

- `media`

Allowed file types:

- JPG
- PNG
- WEBP
- GIF
- SVG, with browser-side unsafe markup checks
- PDF

Max file size is 10MB. Admins can upload and delete. The bucket is private; public pages request signed URLs only for media rows marked `is_public = true`.

## RLS Policies

The schema enables Row Level Security on all CMS tables.

Added policies include:

- Admins can manage posts, categories, tags, join tables, media rows, and settings.
- Public users can read only posts with `status = 'published'` and `published_at <= now()`.
- Drafts, unpublished posts, and scheduled posts are hidden from anonymous users.
- Public users can read categories and tags only when they are attached to published posts.
- Public users can read category/tag join rows only for published posts.
- Public users can read media rows only when `media.is_public = true`.
- Storage uploads, updates, and deletes require an authenticated admin.
- Settings are admin-only in the database.

## Authentication Flow

1. Visit `/admin/login/`.
2. Log in with the approved Supabase Auth account.
3. The browser checks that the email matches `ADMIN_EMAIL`.
4. Supabase RLS checks that the authenticated user has `role = 'admin'` in `public.users`.
5. Unauthenticated visitors are redirected from admin pages to `/admin/login/`.

The static admin HTML can technically be downloaded, because this is an Eleventy static deployment. It does not expose drafts or allow writes. Draft reads and all admin writes are blocked by Supabase Auth and RLS unless the user is an approved admin.

## Create The First Admin User

1. In Supabase Dashboard, disable public signups under Authentication settings.
2. Create a user manually in Authentication.
3. Run:

```sql
update public.users
set role = 'admin'
where email = 'you@example.com';
```

If the `public.users` row does not exist yet, sign in once from `/admin/login/`, then run the update.

## Write And Publish A Post

1. Go to `/admin/login/`.
2. Log in.
3. Open `/admin/posts/`.
4. Click `New post`.
5. Write in the browser editor.
6. Add title, slug, excerpt, categories, tags, and SEO fields.
7. Use `Preview` for a draft preview.
8. Click `Save` to keep it as a draft.
9. Click `Publish` to publish.
10. Published posts appear on `/blog/` and `/blog/your-slug`.

Use `Unpublish` to return a post to draft status. Use `Delete` to remove it.

## Upload Media

1. Go to `/admin/media/`.
2. Drop files into the upload area or choose files.
3. Copy the uploaded URL.
4. Paste it into the featured image field or insert it into the editor.
5. Publish the post that references the media.

Media is reusable across posts.

## Apply The CMS Completion Migration

For an existing Supabase project that already has the earlier schema, run:

```sql
-- supabase/migrations/20260628_cms_completion.sql
```

This adds Markdown storage, gallery data, related post IDs, responsive media metadata, `routes`, and `checkins`, plus the RLS policies needed by the new CMS pages and public map.

For the editor autosave, social SEO, and scheduled publishing improvements, also run:

```sql
-- supabase/migrations/20260628_editor_autosave_seo_schedule.sql
```

This adds `publish_at`, social share fields, `autosave_payload`, and `autosaved_at`. Public post reads now include `published` and `scheduled` posts only when `coalesce(publish_at, published_at) <= now()`.

## Editor Workflow

- Autosave runs every 30 seconds and when leaving the editor with unsaved changes.
- Cmd/Ctrl + S saves; Cmd/Ctrl + Shift + P publishes.
- Autosave keeps existing published posts safe by writing pending edits to `autosave_payload` instead of changing the live row.
- Drag images into the editor upload area to upload them to Supabase Storage and insert them into the story.
- Use `Use Travel Day Template` to append the reusable travel-day section structure.

## Manage The Map

1. Go to `/admin/check-ins/`.
2. Add location name, latitude, longitude, date, cover image, note, related post slug, public/private state, and sort order.
3. Set `Public` to `true` when the check-in should appear on `/map/`.
4. Use sort order to control editorial ordering in the CMS and public map fetch.

Public visitors can only read rows where `is_public = true`.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Eleventy does not apply Vercel rewrites locally, so edit links use `/admin/posts/edit/?id=:id` during local development. Production uses `/admin/posts/:id/edit/`.

## Vercel Deployment

1. Push the code to GitHub.
2. Import the repository in Vercel.
3. Build command: `npm run build`
4. Output directory: `_site`
5. Add all environment variables listed above.
6. Deploy.

`vercel.json` adds:

- `/blog/:slug` rewrite to `/blog/post.html`
- `/admin/posts/:id/edit` rewrite to `/admin/posts/edit.html`
- `X-Robots-Tag: noindex, nofollow` for admin routes
- CSP, referrer, permissions, and content-type headers

## Security Checks

Test public draft protection:

1. Create a draft post.
2. Open a private browser window.
3. Visit `/blog/`.
4. Confirm the draft does not appear.
5. Visit `/blog/draft-slug`.
6. Confirm it shows not found.

Test admin protection:

1. Sign out.
2. Visit `/admin/posts/`.
3. Confirm you are redirected to `/admin/login/`.
4. Try the Supabase REST endpoint for `posts` without a session.
5. Confirm draft rows are not returned.

Test write protection:

1. Use a non-admin Supabase Auth user.
2. Log in.
3. Confirm post writes fail because RLS requires `public.users.role = 'admin'`.

## Security Notes

- No service role key is used in browser code.
- SQL injection protection is handled by Supabase client parameterization and RLS.
- Rich text is sanitized with DOMPurify before saving and before public rendering.
- SVG uploads are blocked if they contain scripts, event handlers, or `foreignObject`.
- Login retry cooldown is implemented in the browser; configure Supabase Auth rate limits for the authoritative throttle.
- CSRF risk is low because admin writes use bearer-token authenticated Supabase requests instead of cookie-authenticated form posts.
