# Now Roaming CMS

This project is still an Eleventy site, but content can now be managed through Supabase:

- Public site: `/blog/` lists published database posts.
- Public post route: `/blog/my-post-slug` is rewritten by Vercel to `/blog/post.html`.
- Admin dashboard: `/admin/`
- Post editor: `/admin/editor/`
- Media library: `/admin/media/`
- Settings: `/admin/settings/`

The original Markdown posts remain available as legacy/static content. New posts should be created in the CMS.

## New Files

- `.env.example`
- `.gitignore`
- `_data/cms.js`
- `admin/index.html`
- `admin/editor.html`
- `admin/media.html`
- `admin/settings.html`
- `blog/index.html`
- `blog/post.html`
- `docs/CMS.md`
- `js/cms-admin.js`
- `js/cms-public.js`
- `js/supabase-client.js`
- `rss.xml.njk`
- `supabase/schema.sql`
- `vercel.json`

## Modified Files

- `.eleventy.js`
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
SITE_URL=https://nowroaming.com
```

Do not add the Supabase service role key to this project. The anon key is public by design; Row Level Security protects private actions.

## Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor.
3. Run the full contents of `supabase/schema.sql`.
4. In Storage, create a public bucket named `media`.
5. In Authentication settings, disable public signups.
6. Create your admin user manually in Supabase Auth.
7. Grant that user admin access:

```sql
update public.users
set role = 'admin'
where email = 'you@example.com';
```

If the user row does not exist yet, sign in once or insert it manually with the auth user id.

## Authentication Flow

Admin pages load as static Eleventy pages. They check for an active Supabase Auth session in the browser. If there is no session, only the login form is shown.

After login, the browser checks that the signed-in email matches `ADMIN_EMAIL`. Database writes are still protected by Supabase RLS, so a matching email alone is not enough; the user must also have `role = 'admin'` in `public.users`.

Visitors never need accounts and can only read rows that are published and whose `published_at` date is not in the future.

## Storage

Uploads go to the Supabase Storage bucket named `media`. The media library accepts JPG, PNG, WEBP, GIF, SVG, and PDF files up to 10MB.

The browser validates file type and size before upload. Supabase Storage policies allow public reads and admin-only writes/deletes.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open the local URL printed by Eleventy. Rebuild after changing `.env` because the public Supabase config is injected at build time.

## Deployment To Vercel

1. Import the repository into Vercel.
2. Set the build command to `npm run build`.
3. Set the output directory to `_site`.
4. Add the environment variables listed above.
5. Deploy.

`vercel.json` rewrites `/blog/:slug` to the static post reader and marks `/admin/*` as noindex.

## Publishing Your First Article

1. Visit `/admin/`.
2. Log in with the admin email/password you created in Supabase Auth.
3. Click `New post`.
4. Add title, slug, excerpt, body, categories, tags, and SEO fields.
5. Choose `Draft`, `Published`, or `Scheduled`.
6. Use `Preview` to review the article.
7. Click `Save`.
8. Published posts appear on `/blog/` and at `/blog/your-slug`.

## Uploading Media

1. Visit `/admin/media/`.
2. Drop files into the upload area or choose files.
3. Copy the uploaded file URL.
4. Paste it into the featured image field or insert it into the editor.

## Complete SQL Schema

The complete schema is maintained in `supabase/schema.sql`. It includes:

- `users`
- `posts`
- `categories`
- `tags`
- `post_categories`
- `post_tags`
- `media`
- `settings`
- `published_posts` view
- RLS policies
- Storage object policies

## Notes And Future Extensions

The schema is intentionally normalized and can later support projects, travel journal entries, galleries, case studies, newsletter subscribers, comments, and multiple authors without replacing the current CMS shell.

For stronger image resizing, add a Vercel image proxy or Supabase Edge Function later. The current implementation preserves aspect ratio, lazy loads images, and stores clean public URLs.
