import DOMPurify from "https://esm.sh/dompurify@3.2.6";
import { cmsConfig, escapeHtml, estimateReadTime, formatDate, hasSupabaseConfig, slugify, supabase } from "./supabase-client.js";

const page = document.querySelector("[data-admin-page]")?.dataset.adminPage;
const loginForm = document.querySelector("[data-admin-login]");
const logoutButtons = document.querySelectorAll("[data-admin-logout]");
const appNodes = document.querySelectorAll(".admin-app");
const messageEl = document.querySelector("[data-admin-message]");

if (!hasSupabaseConfig()) {
  setMessage("Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY, then rebuild.");
  if (!messageEl) {
    document.querySelector(".admin-panel")?.insertAdjacentHTML("beforeend", `<p class="admin-message">Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY, then rebuild.</p>`);
  }
} else {
  initAuth();
}

async function initAuth() {
  logoutButtons.forEach((button) => button.addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.href = "/admin/login/";
  }));

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isLoginCoolingDown()) {
      setMessage("Too many login attempts. Please wait a minute and try again.");
      return;
    }
    const form = new FormData(loginForm);
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (cmsConfig.adminEmail && email !== cmsConfig.adminEmail.toLowerCase()) {
      setMessage("This email is not authorized for the admin.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: String(form.get("password") || "")
    });
    if (error) {
      recordFailedLogin();
      setMessage(error.message);
      return;
    }
    clearFailedLogins();
    const next = new URLSearchParams(location.search).get("next");
    if (next && next.startsWith("/admin/")) {
      location.href = next;
      return;
    }
    location.href = "/admin/";
  });

  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    if (page !== "login") {
      location.href = `/admin/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    return;
  }
  const email = data.session.user.email?.toLowerCase();
  if (cmsConfig.adminEmail && email !== cmsConfig.adminEmail.toLowerCase()) {
    await supabase.auth.signOut();
    setMessage("This signed-in user is not authorized.");
    return;
  }
  if (page === "login") {
    location.href = "/admin/";
    return;
  }
  await revealApp();
}

function failedLoginKey() {
  return "now_roaming_failed_logins";
}

function failedLogins() {
  try {
    return JSON.parse(localStorage.getItem(failedLoginKey()) || "[]");
  } catch {
    return [];
  }
}

function isLoginCoolingDown() {
  const recent = failedLogins().filter((time) => Date.now() - time < 60_000);
  return recent.length >= 5;
}

function recordFailedLogin() {
  const recent = failedLogins().filter((time) => Date.now() - time < 60_000);
  recent.push(Date.now());
  localStorage.setItem(failedLoginKey(), JSON.stringify(recent));
}

function clearFailedLogins() {
  localStorage.removeItem(failedLoginKey());
}

async function revealApp() {
  loginForm?.setAttribute("hidden", "");
  appNodes.forEach((node) => node.removeAttribute("hidden"));
  if (page === "dashboard" || page === "posts") await initDashboard();
  if (page === "editor") await initEditor();
  if (page === "media") await initMedia();
  if (page === "settings") await initSettings();
}

function setMessage(value, target = messageEl) {
  if (target) target.textContent = value;
}

async function initDashboard() {
  const table = document.querySelector("[data-post-table]");
  const search = document.querySelector("[data-post-search]");
  const status = document.querySelector("[data-post-status]");
  const category = document.querySelector("[data-post-category]");
  const sort = document.querySelector("[data-post-sort]");
  const { data, error } = await supabase.from("posts").select("*, post_categories(categories(*)), post_tags(tags(*))").order("updated_at", { ascending: false });
  if (error) {
    table.innerHTML = `<p class="admin-message">${escapeHtml(error.message)}</p>`;
    return;
  }
  const posts = (data || []).map(normalizePost);
  const categories = new Map();
  posts.forEach((post) => post.categories.forEach((item) => categories.set(item.slug, item.name)));
  category.insertAdjacentHTML("beforeend", [...categories].map(([slug, name]) => `<option value="${escapeHtml(slug)}">${escapeHtml(name)}</option>`).join(""));
  const render = () => renderDashboard(posts, table, search.value, status.value, category.value, sort.value);
  [search, status, category, sort].forEach((control) => control.addEventListener("input", render));
  render();
}

function renderDashboard(posts, table, query, status, category, sort) {
  const needle = query.trim().toLowerCase();
  const filtered = posts
    .filter((post) => !needle || [post.title, post.excerpt, post.body_html, ...post.categories.map((x) => x.name), ...post.tags.map((x) => x.name)].join(" ").toLowerCase().includes(needle))
    .filter((post) => !status || post.status === status)
    .filter((post) => !category || post.categories.some((item) => item.slug === category))
    .sort((a, b) => sort === "oldest" ? new Date(a.updated_at) - new Date(b.updated_at) : new Date(b.updated_at) - new Date(a.updated_at));

  table.innerHTML = filtered.length ? filtered.map((post) => `
    <article class="admin-row">
      <div>
        <strong>${escapeHtml(post.title)}</strong>
        <span>${escapeHtml(post.status)} / edited ${formatDate(post.updated_at)}</span>
      </div>
      <div class="admin-actions">
        <a class="button secondary" href="${editPostHref(post.id)}">Edit</a>
        <button class="button secondary" type="button" data-duplicate="${post.id}">Duplicate</button>
        <button class="button secondary" type="button" data-delete="${post.id}">Delete</button>
      </div>
    </article>
  `).join("") : `<p class="admin-message">No posts found.</p>`;

  table.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this post?")) return;
    const { error } = await supabase.from("posts").delete().eq("id", button.dataset.delete);
    if (error) alert(error.message);
    await supabase.rpc("refresh_media_public_flags");
    location.reload();
  }));

  table.querySelectorAll("[data-duplicate]").forEach((button) => button.addEventListener("click", async () => {
    const source = posts.find((post) => post.id === button.dataset.duplicate);
    const copy = { ...source, title: `${source.title} copy`, slug: `${source.slug}-copy`, status: "draft", published_at: null };
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;
    delete copy.categories;
    delete copy.tags;
    const { error } = await supabase.from("posts").insert(copy);
    if (error) alert(error.message);
    location.reload();
  }));
}

function editPostHref(id) {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? `/admin/posts/edit/?id=${id}`
    : `/admin/posts/${id}/edit/`;
}

async function initEditor() {
  const form = document.querySelector("[data-editor-form]");
  const editor = document.querySelector("[data-rich-editor]");
  const message = document.querySelector("[data-editor-message]");
  const slugSource = document.querySelector("[data-slug-source]");
  const slugInput = document.querySelector("[data-slug-input]");
  const postId = getEditorPostId();
  let slugTouched = Boolean(postId);
  const deleteButton = document.querySelector("[data-delete-post]");
  if (deleteButton && !postId) deleteButton.hidden = true;

  slugInput.addEventListener("input", () => slugTouched = true);
  slugSource.addEventListener("input", () => {
    if (!slugTouched) slugInput.value = slugify(slugSource.value);
  });

  document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => {
    const command = button.dataset.command;
    const value = command === "createLink" ? prompt("Paste the URL") : button.dataset.value;
    if (value || command !== "createLink") document.execCommand(command, false, value);
    editor.focus();
  }));
  document.querySelectorAll("[data-insert]").forEach((button) => button.addEventListener("click", () => insertBlock(button.dataset.insert, editor)));

  if (postId) {
    const { data, error } = await supabase.from("posts").select("*, post_categories(categories(*)), post_tags(tags(*))").eq("id", postId).single();
    if (error) setMessage(error.message, message);
    else fillEditor(form, editor, normalizePost(data));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = await collectPostPayload(form, editor);
    const request = postId
      ? supabase.from("posts").update(payload).eq("id", postId).select().single()
      : supabase.from("posts").insert(payload).select().single();
    const { data, error } = await request;
    if (error) {
      setMessage(error.message, message);
      return;
    }
    await syncTaxonomy(data.id, fieldList(form.categories.value), fieldList(form.tags.value));
    await supabase.rpc("refresh_media_public_flags");
    setMessage("Saved.", message);
    history.replaceState(null, "", `/admin/posts/${data.id}/edit/`);
  });

  document.querySelector("[data-preview-post]")?.addEventListener("click", () => previewPost(form, editor));
  document.querySelector("[data-publish-post]")?.addEventListener("click", () => {
    form.status.value = "published";
    if (!form.published_at.value) form.published_at.value = localDateTimeValue(new Date());
    form.requestSubmit();
  });
  document.querySelector("[data-unpublish-post]")?.addEventListener("click", () => {
    form.status.value = "draft";
    form.published_at.value = "";
    form.requestSubmit();
  });
  deleteButton?.addEventListener("click", async () => {
    if (!postId || !confirm("Delete this post?")) return;
    const { error } = await supabase.from("posts").delete().eq("id", postId);
    if (error) {
      setMessage(error.message, message);
      return;
    }
    await supabase.rpc("refresh_media_public_flags");
    location.href = "/admin/posts/";
  });
}

function getEditorPostId() {
  const queryId = new URLSearchParams(location.search).get("id");
  if (queryId) return queryId;
  return location.pathname.match(/\/admin\/posts\/([^/]+)\/edit\/?$/)?.[1] || null;
}

function insertBlock(type, editor) {
  const prompts = {
    image: "Image URL",
    youtube: "YouTube URL"
  };
  let html = "";
  if (type === "checklist") html = `<ul class="checklist"><li><input type="checkbox"> Checklist item</li></ul>`;
  if (type === "table") html = `<table><tbody><tr><th>Heading</th><th>Heading</th></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table>`;
  if (type === "hr") html = `<hr>`;
  if (type === "image") {
    const url = prompt(prompts.image);
    if (!url) return;
    html = `<figure><img src="${escapeHtml(url)}" alt="" loading="lazy"><figcaption>Caption</figcaption></figure>`;
  }
  if (type === "youtube") {
    const url = prompt(prompts.youtube);
    const id = extractYoutubeId(url);
    if (!id) return;
    html = `<iframe src="https://www.youtube.com/embed/${id}" title="YouTube video" loading="lazy" allowfullscreen></iframe>`;
  }
  document.execCommand("insertHTML", false, html);
  editor.focus();
}

function extractYoutubeId(url) {
  return String(url || "").match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1];
}

function fillEditor(form, editor, post) {
  Object.entries(post).forEach(([key, value]) => {
    if (form.elements[key] && typeof value !== "object") form.elements[key].value = value || "";
  });
  form.categories.value = post.categories.map((item) => item.name).join(", ");
  form.tags.value = post.tags.map((item) => item.name).join(", ");
  if (post.published_at) form.published_at.value = new Date(post.published_at).toISOString().slice(0, 16);
  editor.innerHTML = sanitizeRichText(post.body_html || "");
}

async function collectPostPayload(form, editor) {
  const bodyHtml = sanitizeRichText(editor.innerHTML.trim());
  return {
    title: form.title.value.trim(),
    slug: slugify(form.slug.value),
    subtitle: form.subtitle.value.trim() || null,
    excerpt: form.excerpt.value.trim() || null,
    body_html: bodyHtml,
    author: form.author.value.trim() || "Joseph Huckabee",
    status: form.status.value,
    published_at: form.status.value === "draft" ? null : form.published_at.value || new Date().toISOString(),
    featured_image_url: form.featured_image_url.value.trim() || null,
    og_image_url: form.og_image_url.value.trim() || null,
    canonical_url: form.canonical_url.value.trim() || null,
    seo_title: form.seo_title.value.trim() || null,
    meta_description: form.meta_description.value.trim() || null,
    reading_time_minutes: estimateReadTime(bodyHtml)
  };
}

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function syncTaxonomy(postId, categories, tags) {
  await supabase.from("post_categories").delete().eq("post_id", postId);
  await supabase.from("post_tags").delete().eq("post_id", postId);
  if (categories.length) {
    const records = await upsertTerms("categories", categories);
    await supabase.from("post_categories").insert(records.map((item) => ({ post_id: postId, category_id: item.id })));
  }
  if (tags.length) {
    const records = await upsertTerms("tags", tags);
    await supabase.from("post_tags").insert(records.map((item) => ({ post_id: postId, tag_id: item.id })));
  }
}

async function upsertTerms(table, names) {
  const rows = names.map((name) => ({ name, slug: slugify(name) }));
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "slug" });
  if (error) throw error;
  const { data } = await supabase.from(table).select("*").in("slug", rows.map((row) => row.slug));
  return data || [];
}

function fieldList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizePost(post) {
  return {
    ...post,
    categories: (post.post_categories || []).map((item) => item.categories).filter(Boolean),
    tags: (post.post_tags || []).map((item) => item.tags).filter(Boolean)
  };
}

function previewPost(form, editor) {
  const dialog = document.querySelector("[data-preview-dialog]");
  const content = document.querySelector("[data-preview-content]");
  content.innerHTML = `
    <header class="post-hero">
      <p class="eyebrow">${escapeHtml(form.author.value || "Journal")}</p>
      <h1>${escapeHtml(form.title.value || "Untitled")}</h1>
      <p>${escapeHtml(form.excerpt.value || form.subtitle.value || "")}</p>
    </header>
    <div class="post-body">${sanitizeRichText(editor.innerHTML)}</div>
  `;
  dialog.showModal();
  document.querySelector("[data-close-preview]").onclick = () => dialog.close();
}

async function initMedia() {
  const drop = document.querySelector("[data-media-drop]");
  const input = document.querySelector("[data-media-input]");
  const grid = document.querySelector("[data-media-grid]");
  const search = document.querySelector("[data-media-search]");
  const progress = document.querySelector("[data-upload-progress]");
  let media = await loadMedia();
  const render = () => renderMedia(grid, media, search.value);
  search.addEventListener("input", render);
  input.addEventListener("change", () => uploadFiles(input.files));
  ["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("dragging");
  }));
  drop.addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files));
  render();

  async function uploadFiles(files) {
    const list = [];
    for (const file of files) {
      if (await validFile(file)) list.push(file);
    }
    progress.hidden = false;
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from("media").upload(path, file, { upsert: false });
      if (error) {
        alert(error.message);
        continue;
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      await supabase.from("media").insert({ bucket: "media", path, url: data.publicUrl, name: file.name, mime_type: file.type, size_bytes: file.size });
      progress.value = Math.round(((index + 1) / list.length) * 100);
    }
    media = await loadMedia();
    progress.hidden = true;
    render();
  }
}

async function validFile(file) {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "application/pdf"];
  const maxSize = 10 * 1024 * 1024;
  if (!allowed.includes(file.type) || file.size > maxSize) {
    alert(`${file.name} is not an allowed file or is over 10MB.`);
    return false;
  }
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    if (/<script|on\w+=|<foreignObject/i.test(text)) {
      alert(`${file.name} contains unsafe SVG markup and was blocked.`);
      return false;
    }
  }
  return true;
}

function safeFileName(name) {
  const extension = String(name).split(".").pop().toLowerCase();
  const base = String(name).replace(/\.[^.]+$/, "");
  return `${slugify(base) || "upload"}.${extension}`;
}

async function loadMedia() {
  const { data } = await supabase.from("media").select("*").order("created_at", { ascending: false });
  return Promise.all((data || []).map(async (item) => {
    const { data: signed } = await supabase.storage.from("media").createSignedUrl(item.path, 60 * 60);
    return {
      ...item,
      display_url: signed?.signedUrl || item.url
    };
  }));
}

function renderMedia(grid, media, query) {
  const needle = query.trim().toLowerCase();
  const visible = media.filter((item) => !needle || [item.name, item.path, item.mime_type].join(" ").toLowerCase().includes(needle));
  grid.innerHTML = visible.map((item) => `
    <article class="media-card">
      ${item.mime_type === "application/pdf" ? `<iframe src="${escapeHtml(item.display_url)}" title="${escapeHtml(item.name)}"></iframe>` : `<img src="${escapeHtml(item.display_url)}" alt="" loading="lazy">`}
      <strong>${escapeHtml(item.name)}</strong>
      <div class="admin-actions">
        <button type="button" data-copy="${escapeHtml(item.url)}">Copy URL</button>
        <button type="button" data-remove-media="${item.id}" data-path="${escapeHtml(item.path)}">Delete</button>
      </div>
    </article>
  `).join("");
  grid.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => navigator.clipboard.writeText(button.dataset.copy)));
  grid.querySelectorAll("[data-remove-media]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this media file?")) return;
    await supabase.storage.from("media").remove([button.dataset.path]);
    await supabase.from("media").delete().eq("id", button.dataset.removeMedia);
    location.reload();
  }));
}

async function initSettings() {
  const form = document.querySelector("[data-settings-form]");
  const message = document.querySelector("[data-settings-message]");
  const { data } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (data) {
    Object.entries(data).forEach(([key, value]) => {
      if (!form.elements[key]) return;
      form.elements[key].value = typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : value || "";
    });
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      id: 1,
      blog_title: form.blog_title.value,
      blog_description: form.blog_description.value,
      hero_text: form.hero_text.value,
      profile_image_url: form.profile_image_url.value || null,
      author_name: form.author_name.value,
      author_bio: form.author_bio.value,
      social_links: parseJson(form.social_links.value, {}),
      seo_defaults: parseJson(form.seo_defaults.value, {}),
      analytics_ids: parseJson(form.analytics_ids.value, {}),
      contact_info: form.contact_info.value
    };
    const { error } = await supabase.from("settings").upsert(payload);
    setMessage(error ? error.message : "Settings saved.", message);
  });
}

function parseJson(value, fallback) {
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    alert("One JSON field is invalid.");
    throw new Error("Invalid JSON");
  }
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
