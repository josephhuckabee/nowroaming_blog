# Sanity Compatibility

The Eleventy markdown posts use fields that map directly to `sanity/schemas/post.js`.

Markdown front matter:

```yaml
layout: layouts/post.njk
title: "Stop 1: Beijing"
date: 2026-04-22
location: "Stop 1: Beijing"
category: Arrivals
readTime: 7 min read
excerpt: Short homepage preview.
dek: "6,800 miles from home"
seoTitle: "Stop 1: Beijing | Now Roaming"
seoDescription: "A first-day travel journal from Beijing about arrival, reset, and long-term roaming."
keywords:
  - Beijing travel journal
  - long-term travel
  - arrivals
tags: posts
```

Sanity fields:

- `title`
- `slug`
- `date`
- `location`
- `category`
- `readTime`
- `excerpt`
- `dek`
- `seoTitle`
- `seoDescription`
- `keywords`
- `image`
- `body`

If you add Sanity Studio later, keep these names to avoid migration pain.
