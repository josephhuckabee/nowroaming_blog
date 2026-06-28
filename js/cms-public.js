import DOMPurify from "https://esm.sh/dompurify@3.2.6";
import { cmsConfig, escapeHtml, formatDate, hasSupabaseConfig, postUrl, supabase, supabaseKeyProblem } from "./supabase-client.js";

const listEl = document.querySelector("[data-public-posts]");
const detailEl = document.querySelector("[data-post-detail]");

if (!hasSupabaseConfig()) {
  showConfigMessage();
} else if (listEl) {
  initPublicList();
} else if (detailEl) {
  initPostDetail();
}

function showConfigMessage() {
  const target = listEl || detailEl;
  if (target) {
    target.innerHTML = `<p class="admin-message">${escapeHtml(supabaseKeyProblem(cmsConfig.supabaseAnonKey) || "Supabase is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY, then rebuild.")}</p>`;
  }
}

async function initPublicList() {
  const searchInput = document.querySelector("[data-public-search]");
  const categorySelect = document.querySelector("[data-public-category]");
  const tagSelect = document.querySelector("[data-public-tag]");
  const { data, error } = await supabase
    .from("published_posts")
    .select("*")
    .order("published_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<p class="admin-message">${escapeHtml(error.message)}</p>`;
    return;
  }

  const posts = data || [];
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
    : `<p class="admin-message">No published posts match that search.</p>`;
}

function cardTemplate(post) {
  const categories = (post.categories || []).map((category) => `<span>${escapeHtml(category.name)}</span>`).join("");
  return `
    <a class="post-card" href="${postUrl(post)}">
      <article>
        <div class="post-meta">
          <span>${formatDate(post.published_at)}</span>
          <span>${post.reading_time_minutes || 1} min read</span>
        </div>
        ${categories ? `<div class="category-tags">${categories}</div>` : ""}
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.excerpt || post.subtitle || "")}</p>
      </article>
    </a>
  `;
}

async function initPostDetail() {
  const slug = decodeURIComponent(location.pathname.replace(/^\/blog\/?/, "").replace(/\/$/, "")) || new URLSearchParams(location.search).get("slug");
  const { data: post, error } = await supabase
    .from("published_posts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !post) {
    detailEl.innerHTML = `<header class="post-hero"><p class="eyebrow">Journal</p><h1>Post not found</h1><p>This post is not published yet.</p></header>`;
    return;
  }

  document.title = `${post.seo_title || post.title} | Now Roaming`;
  setMeta("description", post.meta_description || post.excerpt || "");
  setMeta("og:title", post.seo_title || post.title, "property");
  setMeta("og:description", post.meta_description || post.excerpt || "", "property");
  setMeta("twitter:title", post.seo_title || post.title);
  setMeta("twitter:description", post.meta_description || post.excerpt || "");

  const mediaMap = await signedPublishedMediaMap(post);
  const postWithMedia = applySignedMedia(post, mediaMap);
  const related = await fetchRelated(postWithMedia);
  detailEl.innerHTML = detailTemplate(postWithMedia, related);
}

async function fetchRelated(post) {
  const tagSlugs = (post.tags || []).map((tag) => tag.slug);
  const categorySlugs = (post.categories || []).map((category) => category.slug);
  const { data } = await supabase.from("published_posts").select("*").neq("id", post.id).limit(6);
  return (data || [])
    .filter((candidate) => {
      return (candidate.tags || []).some((tag) => tagSlugs.includes(tag.slug)) ||
        (candidate.categories || []).some((category) => categorySlugs.includes(category.slug));
    })
    .slice(0, 3);
}

function detailTemplate(post, related) {
  const categories = (post.categories || []).map((category) => `<span>${escapeHtml(category.name)}</span>`).join("");
  const attachments = (post.attachments || []).map((file) => `<a class="button secondary" href="${escapeHtml(file.url)}" download>${escapeHtml(file.name || "Download")}</a>`).join("");
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
      ${categories ? `<div class="category-tags">${categories}</div>` : ""}
      <div class="post-meta">
        <span>${formatDate(post.published_at)}</span>
        <span>${post.reading_time_minutes || 1} min read</span>
      </div>
      <p>${escapeHtml(post.excerpt || post.subtitle || "")}</p>
    </header>
    ${post.featured_image_url ? `<img class="post-featured-image" src="${escapeHtml(post.featured_image_url)}" alt="" loading="eager">` : ""}
    <div class="post-body">${sanitizeRichText(post.body_html || "")}</div>
    ${attachments ? `<div class="attachment-list">${attachments}</div>` : ""}
    ${relatedHtml}
  `;
}

function setMeta(name, content, attr = "name") {
  const meta = document.querySelector(`meta[${attr}="${name}"]`);
  if (meta && content) meta.setAttribute("content", content);
}

async function signedPublishedMediaMap(post) {
  const haystack = [
    post.featured_image_url,
    post.og_image_url,
    post.body_html,
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
    body_html: replace(post.body_html),
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
