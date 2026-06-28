import DOMPurify from "https://esm.sh/dompurify@3.2.6";
import { cmsConfig, escapeHtml, formatDate, hasSupabaseConfig, postUrl, supabase } from "./supabase-client.js";

const listEl = document.querySelector("[data-public-posts]");
const detailEl = document.querySelector("[data-post-detail]");
const mapEl = document.querySelector("[data-world-map]");
const homeJournalEl = document.querySelector("[data-home-journal]");
const homePostCountEl = document.querySelector("[data-home-post-count]");

if (!hasSupabaseConfig()) {
  showConfigMessage();
} else if (homeJournalEl) {
  initHomeJournal();
} else if (listEl) {
  initPublicList();
} else if (detailEl) {
  initPostDetail();
} else if (mapEl) {
  initMap();
}

function showConfigMessage() {
  const target = homeJournalEl || listEl || detailEl || mapEl;
  if (target) {
    target.innerHTML = `<p class="admin-message">Journal posts are temporarily unavailable.</p>`;
  }
}

function publishedPostsQuery() {
  const now = new Date().toISOString();
  return supabase
    .from("posts")
    .select("*, post_categories(categories(*)), post_tags(tags(*))")
    .eq("status", "published")
    .or(`published_at.is.null,published_at.lte.${now}`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
}

function normalizePost(post) {
  return {
    ...post,
    categories: post.categories || (post.post_categories || []).map((item) => item.categories).filter(Boolean),
    tags: post.tags || (post.post_tags || []).map((item) => item.tags).filter(Boolean)
  };
}

async function initHomeJournal() {
  const { data, error } = await publishedPostsQuery();
  if (error) {
    homeJournalEl.innerHTML = `<p class="admin-message">The journal is temporarily unavailable.</p>`;
    return;
  }
  const posts = await withSignedMedia((data || []).map(normalizePost));
  if (homePostCountEl) homePostCountEl.textContent = String(posts.length);
  renderHomeJournal(posts);
}

function renderHomeJournal(posts) {
  if (!posts.length) {
    homeJournalEl.innerHTML = `<p class="admin-message">No published journal posts yet.</p>`;
    return;
  }
  const [featured, ...secondary] = posts;
  const featuredImage = featured.featured_image_url || "/images/now-roaming-hero.png";
  homeJournalEl.innerHTML = `
    <a class="feature-post" href="${postUrl(featured)}" style="--post-cover: url('${escapeAttribute(featuredImage)}')">
      <article>
        <div class="post-meta">
          <span>${formatDate(featured.published_at || featured.created_at)}</span>
          <span>${featured.reading_time_minutes || 1} min read</span>
        </div>
        ${categoryTags(featured)}
        <h3>${escapeHtml(featured.title)}</h3>
        <p>${escapeHtml(featured.excerpt || featured.subtitle || "")}</p>
      </article>
    </a>
    <div class="post-list">
      ${secondary.slice(0, 3).map(cardTemplate).join("")}
    </div>
  `;
}

async function initPublicList() {
  const searchInput = document.querySelector("[data-public-search]");
  const categorySelect = document.querySelector("[data-public-category]");
  const tagSelect = document.querySelector("[data-public-tag]");
  const { data, error } = await publishedPostsQuery();

  if (error) {
    listEl.innerHTML = `<p class="admin-message">The journal is temporarily unavailable.</p>`;
    return;
  }

  const posts = await withSignedMedia((data || []).map(normalizePost));
  hydrateFilters(posts, categorySelect, tagSelect);
  const render = () => renderList(posts, searchInput.value, categorySelect.value, tagSelect.value);
  [searchInput, categorySelect, tagSelect].forEach((control) => control.addEventListener("input", render));
  render();
}

function hydrateFilters(posts, categorySelect, tagSelect) {
  const categories = new Map();
  const tags = new Map();
  posts.forEach((post) => {
    (post.categories || []).forEach((category) => categories.set(category.slug, category.name));
    (post.tags || []).forEach((tag) => tags.set(tag.slug, tag.name));
  });
  categorySelect.insertAdjacentHTML("beforeend", [...categories].map(([slug, name]) => `<option value="${escapeHtml(slug)}">${escapeHtml(name)}</option>`).join(""));
  tagSelect.insertAdjacentHTML("beforeend", [...tags].map(([slug, name]) => `<option value="${escapeHtml(slug)}">${escapeHtml(name)}</option>`).join(""));
}

function renderList(posts, query, categorySlug, tagSlug) {
  const needle = query.trim().toLowerCase();
  const filtered = posts.filter((post) => {
    const searchable = [post.title, post.subtitle, post.excerpt, post.body_html, ...(post.categories || []).map((x) => x.name), ...(post.tags || []).map((x) => x.name)].join(" ").toLowerCase();
    const matchesQuery = !needle || searchable.includes(needle);
    const matchesCategory = !categorySlug || (post.categories || []).some((category) => category.slug === categorySlug);
    const matchesTag = !tagSlug || (post.tags || []).some((tag) => tag.slug === tagSlug);
    return matchesQuery && matchesCategory && matchesTag;
  });

  listEl.innerHTML = filtered.length
    ? filtered.map(cardTemplate).join("")
    : `<p class="admin-message">No published journal posts found.</p>`;
}

function cardTemplate(post) {
  const cover = post.featured_image_url ? `<img class="post-card-image" src="${escapeHtml(post.featured_image_url)}" alt="" loading="lazy">` : "";
  return `
    <a class="post-card${post.featured_image_url ? " has-image" : ""}" href="${postUrl(post)}">
      ${cover}
      <article>
        <div class="post-meta">
          <span>${formatDate(post.published_at || post.created_at)}</span>
          <span>${post.reading_time_minutes || 1} min read</span>
        </div>
        ${categoryTags(post)}
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.excerpt || post.subtitle || "")}</p>
      </article>
    </a>
  `;
}

function categoryTags(post) {
  const categories = (post.categories || []).map((category) => `<span>${escapeHtml(category.name)}</span>`).join("");
  return categories ? `<div class="category-tags">${categories}</div>` : "";
}

async function initPostDetail() {
  const params = new URLSearchParams(location.search);
  const slug = postSlugFromLocation(params);
  const previewId = params.get("preview");
  const { post, error } = previewId ? await fetchPreviewPost(previewId) : await fetchPublishedPostBySlug(slug);

  if (error || !post) {
    detailEl.innerHTML = `<header class="post-hero"><p class="eyebrow">Journal</p><h1>Post not found</h1><p>This post is not published yet, or the address has changed.</p><p><a class="button" href="/blog/">Return to Journal</a></p></header>`;
    return;
  }

  document.title = `${post.seo_title || post.title} | Now Roaming`;
  setMeta("description", post.seo_description || post.meta_description || post.excerpt || "");
  setMeta("og:title", post.social_title || post.seo_title || post.title, "property");
  setMeta("og:description", post.social_description || post.seo_description || post.meta_description || post.excerpt || "", "property");
  setMeta("og:image", post.social_image_url || post.og_image_url || post.featured_image_url || "", "property");
  setMeta("twitter:title", post.social_title || post.seo_title || post.title);
  setMeta("twitter:description", post.social_description || post.seo_description || post.meta_description || post.excerpt || "");
  setMeta("twitter:image", post.social_image_url || post.og_image_url || post.featured_image_url || "");

  const mediaMap = await signedPublishedMediaMap(post);
  const postWithMedia = applySignedMedia(post, mediaMap);
  const related = await fetchRelated(postWithMedia);
  detailEl.innerHTML = detailTemplate(postWithMedia, related);
}

async function fetchRelated(post) {
  if ((post.related_post_ids || []).length) {
    const { data } = await publishedPostsQuery().in("id", post.related_post_ids).limit(3);
    if ((data || []).length) return data.map(normalizePost);
  }
  const tagSlugs = (post.tags || []).map((tag) => tag.slug);
  const categorySlugs = (post.categories || []).map((category) => category.slug);
  const { data } = await publishedPostsQuery().neq("id", post.id).limit(6);
  return (data || []).map(normalizePost)
    .filter((candidate) => {
      return (candidate.tags || []).some((tag) => tagSlugs.includes(tag.slug)) ||
        (candidate.categories || []).some((category) => categorySlugs.includes(category.slug));
    })
    .slice(0, 3);
}

function detailTemplate(post, related) {
  const categories = (post.categories || []).map((category) => `<span>${escapeHtml(category.name)}</span>`).join("");
  const tags = (post.tags || []).map((tag) => `<span>${escapeHtml(tag.name)}</span>`).join("");
  const attachments = (post.attachments || []).map((file) => `<a class="button secondary" href="${escapeHtml(file.url)}" download>${escapeHtml(file.name || "Download")}</a>`).join("");
  const gallery = (post.gallery || []).length ? `<div class="image-gallery">${post.gallery.map((item) => `<figure><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || "")}" loading="lazy"><figcaption>${escapeHtml(item.caption || "")}</figcaption></figure>`).join("")}</div>` : "";
  const relatedHtml = related.length ? `
    <section class="related-posts">
      <h2>Related posts</h2>
      <div class="post-list">${related.map(cardTemplate).join("")}</div>
    </section>
  ` : "";
  return `
    <header class="post-hero">
      <p class="eyebrow">${escapeHtml(post.author || "Journal")}</p>
      <h1>${escapeHtml(post.title)}</h1>
      ${categories || tags ? `<div class="category-tags">${categories}${tags}</div>` : ""}
      <div class="post-meta">
        <span>${formatDate(post.published_at || post.publish_at || post.created_at)}</span>
        <span>${post.reading_time_minutes || 1} min read</span>
      </div>
      <p>${escapeHtml(post.excerpt || post.subtitle || "")}</p>
    </header>
    ${post.featured_image_url ? `<img class="post-featured-image" src="${escapeHtml(post.featured_image_url)}" alt="" loading="eager">` : ""}
    <div class="post-body">${sanitizeRichText(post.body_html || "")}</div>
    ${gallery}
    ${attachments ? `<div class="attachment-list">${attachments}</div>` : ""}
    ${relatedHtml}
  `;
}

async function initMap() {
  const card = document.querySelector("[data-map-card]");
  const timeline = document.querySelector("[data-map-timeline]");
  const { data, error } = await selectCheckIns();
  if (error) {
    mapEl.innerHTML = `<p class="admin-message">The route map is temporarily unavailable.</p>`;
    return;
  }
  const checkins = (data || [])
    .map(normalizeCheckin)
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .sort((a, b) => new Date(a.visited_at || a.created_at) - new Date(b.visited_at || b.created_at));
  if (!checkins.length) {
    mapEl.innerHTML = `<p class="admin-message">No public check-ins yet.</p>`;
    if (timeline) timeline.innerHTML = "";
    return;
  }
  if (!window.L) {
    mapEl.innerHTML = `<p class="admin-message">The route map could not load.</p>`;
    return;
  }
  renderLeafletMap(mapEl, card, checkins);
  if (timeline) renderCheckinTimeline(timeline, card, checkins);
}

async function fetchPublishedPostBySlug(slug) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("posts")
    .select("*, post_categories(categories(*)), post_tags(tags(*))")
    .eq("slug", slug)
    .eq("status", "published")
    .or(`published_at.is.null,published_at.lte.${now}`)
    .maybeSingle();
  return { post: data ? normalizePost(data) : null, error };
}

async function fetchPreviewPost(id) {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return { post: null, error: new Error("Preview requires admin session.") };
  const { data, error } = await supabase
    .from("posts")
    .select("*, post_categories(categories(*)), post_tags(tags(*))")
    .eq("id", id)
    .maybeSingle();
  return { post: data ? normalizePost(data) : null, error };
}

async function selectCheckIns() {
  const query = (table) => supabase.from(table).select("*").eq("is_public", true).order("visited_at", { ascending: true });
  const first = await query("check_ins");
  if (!first.error) return first;
  return query("checkins");
}

function pinTemplate(checkin) {
  const x = ((Number(checkin.longitude) + 180) / 360) * 100;
  const y = ((90 - Number(checkin.latitude)) / 180) * 100;
  return `<button class="map-pin" type="button" style="left:${x}%;top:${y}%" data-checkin-id="${checkin.id}" aria-label="${escapeHtml(checkin.location_name)}"></button>`;
}

function checkinCard(checkin) {
  const photos = checkin.photos.length
    ? `<div class="map-card-gallery">${checkin.photos.map((photo) => `<img src="${escapeHtml(photo.url || photo)}" alt="${escapeHtml(photo.alt || "")}" loading="lazy">`).join("")}</div>`
    : "";
  return `
    ${checkin.cover_image_url ? `<img src="${escapeHtml(checkin.cover_image_url)}" alt="" loading="lazy">` : ""}
    <p class="eyebrow">${escapeHtml(new Date(checkin.visited_at).toLocaleDateString())}</p>
    <h2>${escapeHtml(checkin.location_name)}</h2>
    <p>${escapeHtml(checkin.journal_note || "")}</p>
    ${photos}
    ${checkin.related_post_slug ? `<a class="button" href="/blog/${encodeURIComponent(checkin.related_post_slug)}">Read the article</a>` : ""}
  `;
}

function postSlugFromLocation(params) {
  const querySlug = params.get("slug");
  if (querySlug) return decodeURIComponent(querySlug);
  const path = location.pathname.replace(/\/$/, "");
  if (path === "/blog/post" || path === "/blog/post.html" || path === "/blog") return "";
  return decodeURIComponent(path.replace(/^\/blog\//, ""));
}

function escapeAttribute(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function withSignedMedia(posts) {
  return Promise.all(posts.map(async (post) => {
    const mediaMap = await signedPublishedMediaMap(post);
    return applySignedMedia(post, mediaMap);
  }));
}

function normalizeCheckin(checkin) {
  const photos = Array.isArray(checkin.photos) ? checkin.photos : [];
  const cover = checkin.cover_image_url ? [{ url: checkin.cover_image_url }] : [];
  return {
    ...checkin,
    latitude: Number(checkin.latitude),
    longitude: Number(checkin.longitude),
    photos: photos.length ? photos : cover
  };
}

function renderLeafletMap(container, card, checkins) {
  container.innerHTML = "";
  const map = window.L.map(container, { scrollWheelZoom: false });
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  const points = checkins.map((item) => [item.latitude, item.longitude]);
  const route = window.L.polyline(points, { color: "#d3a650", weight: 3, opacity: 0.86 }).addTo(map);
  checkins.forEach((checkin) => {
    const marker = window.L.circleMarker([checkin.latitude, checkin.longitude], {
      radius: 8,
      color: "#070908",
      weight: 2,
      fillColor: "#d3a650",
      fillOpacity: 1
    }).addTo(map);
    marker.on("click", () => {
      card.innerHTML = checkinCard(checkin);
    });
  });
  map.fitBounds(route.getBounds().pad(0.2));
  card.innerHTML = checkinCard(checkins[checkins.length - 1]);
}

function renderCheckinTimeline(timeline, card, checkins) {
  timeline.innerHTML = checkins.map((checkin) => `
    <button type="button" class="checkin-timeline-item" data-checkin-id="${escapeHtml(checkin.id)}">
      <span>${escapeHtml(formatDate(checkin.visited_at || checkin.created_at))}</span>
      <strong>${escapeHtml(checkin.location_name)}</strong>
      <em>${escapeHtml(checkin.journal_note || "")}</em>
    </button>
  `).join("");
  timeline.querySelectorAll("[data-checkin-id]").forEach((button) => button.addEventListener("click", () => {
    const checkin = checkins.find((item) => item.id === button.dataset.checkinId);
    if (checkin) card.innerHTML = checkinCard(checkin);
  }));
}

function setMeta(name, content, attr = "name") {
  const meta = document.querySelector(`meta[${attr}="${name}"]`);
  if (meta && content) meta.setAttribute("content", content);
}

async function signedPublishedMediaMap(post) {
  const haystack = [
    post.featured_image_url,
    post.og_image_url,
    post.social_image_url,
    post.body_html,
    JSON.stringify(post.gallery || []),
    JSON.stringify(post.attachments || [])
  ].filter(Boolean).join(" ");
  const { data } = await supabase.from("media").select("url,path").eq("is_public", true);
  const referenced = (data || []).filter((item) => item.url && haystack.includes(item.url));
  const entries = await Promise.all(referenced.map(async (item) => {
    const { data: signed } = await supabase.storage.from("media").createSignedUrl(item.path, 60 * 60);
    return [item.url, signed?.signedUrl || item.url];
  }));
  return new Map(entries);
}

function applySignedMedia(post, mediaMap) {
  const replace = (value) => {
    let output = value || "";
    mediaMap.forEach((signedUrl, storedUrl) => {
      output = output.split(storedUrl).join(signedUrl);
    });
    return output;
  };
  return {
    ...post,
    featured_image_url: replace(post.featured_image_url),
    og_image_url: replace(post.og_image_url),
    social_image_url: replace(post.social_image_url),
    body_html: replace(post.body_html),
    gallery: (post.gallery || []).map((item) => ({
      ...item,
      url: replace(item.url)
    })),
    attachments: (post.attachments || []).map((item) => ({
      ...item,
      url: replace(item.url)
    }))
  };
}

function sanitizeRichText(html) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "a", "b", "blockquote", "br", "caption", "code", "div", "em", "figcaption", "figure", "h2", "h3", "h4",
      "hr", "i", "iframe", "img", "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th",
      "thead", "tr", "u", "ul", "input"
    ],
    ALLOWED_ATTR: [
      "allow", "allowfullscreen", "alt", "checked", "class", "colspan", "datetime", "download", "height",
      "href", "loading", "rel", "rowspan", "src", "target", "title", "type", "width"
    ],
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allowfullscreen"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/)/i
  });
}
