import DOMPurify from "https://esm.sh/dompurify@3.2.6";
import { marked } from "https://esm.sh/marked@13.0.3";
import {
  supabase,
  cmsConfig,
  escapeHtml,
  estimateReadTime,
  formatDate,
  hasSupabaseConfig,
  slugify,
  supabaseKeyProblem
} from "./supabase-client.js";

const page = document.querySelector("[data-admin-page]")?.dataset.adminPage;
const loginForm = document.querySelector("[data-admin-login]");
const logoutButtons = document.querySelectorAll("[data-admin-logout]");
const appNodes = document.querySelectorAll(".admin-app");
const messageEl = document.querySelector("[data-admin-message]");
const protectedPages = new Set(["dashboard", "posts", "drafts", "editor", "media", "settings", "categories", "tags", "routes", "checkins"]);
const configProblem = supabaseKeyProblem(cmsConfig.supabaseAnonKey);

hideAllAdminStates();

if (!hasSupabaseConfig()) {
  showFatalConfig();
} else {
  initAuth();
}

function hideAllAdminStates() {
  appNodes.forEach((node) => node.setAttribute("hidden", ""));
  if (loginForm && page !== "login") loginForm.setAttribute("hidden", "");
}

function showFatalConfig() {
  const message = configProblem || "Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY, then rebuild.";
  if (page === "login" && loginForm) loginForm.removeAttribute("hidden");
  setMessage(message);
  document.querySelector(".admin-panel")?.insertAdjacentHTML("beforeend", `<p class="admin-message">${escapeHtml(message)}</p>`);
}

async function initAuth() {
  logoutButtons.forEach((button) => button.addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.href = "/admin/login/";
  }));

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");
    if (isLoginCoolingDown()) {
      setMessage("Too many login attempts. Please wait a minute and try again.");
      return;
    }
    const form = new FormData(loginForm);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    if (!email || !password) {
      setMessage("Enter your admin email and password.");
      return;
    }
    if (cmsConfig.adminEmail && email !== cmsConfig.adminEmail.toLowerCase()) {
      recordFailedLogin();
      setMessage("This email is not authorized for the admin.");
      return;
    }
    const submit = loginForm.querySelector("[type='submit']");
    submit.disabled = true;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      recordFailedLogin();
      submit.disabled = false;
      setMessage(error.message || "Login failed. Check your credentials and try again.");
      return;
    }
    const admin = await verifyAdmin(data.session);
    if (!admin.ok) {
      await supabase.auth.signOut();
      recordFailedLogin();
      submit.disabled = false;
      setMessage(admin.message);
      return;
    }
    clearFailedLogins();
    location.href = "/admin/posts/";
  });

  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    if (page === "login") {
      loginForm?.removeAttribute("hidden");
      return;
    }
    if (protectedPages.has(page)) {
      location.replace(`/admin/login/?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    return;
  }

  const admin = await verifyAdmin(data.session);
  if (!admin.ok) {
    await supabase.auth.signOut();
    if (page === "login") {
      loginForm?.removeAttribute("hidden");
      setMessage(admin.message);
    } else {
      location.replace(`/admin/login/?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    return;
  }

  if (page === "login") {
    location.replace("/admin/posts/");
    return;
  }
  await revealApp();
}

async function verifyAdmin(session) {
  const email = session?.user?.email?.toLowerCase();
  if (!session) return { ok: false, message: "Your session expired. Please log in again." };
  if (cmsConfig.adminEmail && email !== cmsConfig.adminEmail.toLowerCase()) {
    return { ok: false, message: "This signed-in user is not authorized for the admin." };
  }
  const { data, error } = await supabase.from("users").select("role,email").eq("id", session.user.id).maybeSingle();
  if (error) return { ok: false, message: `Admin role check failed: ${error.message}` };
  if (data?.role !== "admin") return { ok: false, message: "This account exists, but it is not marked as an admin in Supabase." };
  return { ok: true };
}

async function revealApp() {
  loginForm?.setAttribute("hidden", "");
  appNodes.forEach((node) => node.removeAttribute("hidden"));
  if (page === "dashboard" || page === "posts" || page === "drafts") await initPosts(page === "drafts" ? "draft" : "");
  if (page === "editor") await initEditor();
  if (page === "media") await initMedia();
  if (page === "settings") await initSettings();
  if (page === "categories") await initTerms("categories");
  if (page === "tags") await initTerms("tags");
  if (page === "routes") await initSimpleManager("routes", routeFields());
  if (page === "checkins") await initCheckins();
}

function setMessage(value, target = messageEl) {
  if (target) target.textContent = value;
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
  return failedLogins().filter((time) => Date.now() - time < 60_000).length >= 5;
}

function recordFailedLogin() {
  const recent = failedLogins().filter((time) => Date.now() - time < 60_000);
  recent.push(Date.now());
  localStorage.setItem(failedLoginKey(), JSON.stringify(recent));
}

function clearFailedLogins() {
  localStorage.removeItem(failedLoginKey());
}

async function initPosts(forcedStatus = "") {
  const table = document.querySelector("[data-post-table]");
  const search = document.querySelector("[data-post-search]");
  const status = document.querySelector("[data-post-status]");
  const category = document.querySelector("[data-post-category]");
  const sort = document.querySelector("[data-post-sort]");
  table.innerHTML = `<p class="admin-message">Loading posts...</p>`;
  const { data, error } = await supabase.from("posts").select("*, post_categories(categories(*)), post_tags(tags(*))").order("updated_at", { ascending: false });
  if (error) return table.innerHTML = `<p class="admin-message">${escapeHtml(error.message)}</p>`;
  const posts = (data || []).map(normalizePost);
  const categories = new Map();
  posts.forEach((post) => post.categories.forEach((item) => categories.set(item.slug, item.name)));
  if (category) category.insertAdjacentHTML("beforeend", [...categories].map(([slug, name]) => `<option value="${escapeHtml(slug)}">${escapeHtml(name)}</option>`).join(""));
  if (forcedStatus && status) status.value = forcedStatus;
  const render = () => renderPosts(posts, table, search?.value || "", forcedStatus || status?.value || "", category?.value || "", sort?.value || "newest");
  [search, status, category, sort].filter(Boolean).forEach((control) => control.addEventListener("input", render));
  render();
}

function renderPosts(posts, table, query, status, category, sort) {
  const needle = query.trim().toLowerCase();
  const filtered = posts
    .filter((post) => !needle || [post.title, post.excerpt, post.body_html, post.body_markdown, ...post.categories.map((x) => x.name), ...post.tags.map((x) => x.name)].join(" ").toLowerCase().includes(needle))
    .filter((post) => !status || post.status === status)
    .filter((post) => !category || post.categories.some((item) => item.slug === category))
    .sort((a, b) => sort === "oldest" ? new Date(a.updated_at) - new Date(b.updated_at) : new Date(b.updated_at) - new Date(a.updated_at));

  table.innerHTML = filtered.length ? filtered.map((post) => `
    <article class="admin-row">
      <div>
        <strong>${escapeHtml(post.title)}</strong>
        <span>${escapeHtml(post.status)} / edited ${formatDate(post.updated_at)} / ${post.reading_time_minutes || 1} min</span>
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
    await safeRefreshMediaFlags();
    location.reload();
  }));

  table.querySelectorAll("[data-duplicate]").forEach((button) => button.addEventListener("click", async () => {
    const source = posts.find((post) => post.id === button.dataset.duplicate);
    const copy = { ...source, title: `${source.title} copy`, slug: `${source.slug}-copy-${Date.now()}`, status: "draft", published_at: null };
    ["id", "created_at", "updated_at", "categories", "tags", "post_categories", "post_tags"].forEach((key) => delete copy[key]);
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
  const markdown = document.querySelector("[data-markdown-editor]");
  const message = document.querySelector("[data-editor-message]");
  const saveStatus = document.querySelector("[data-save-status]");
  const slugSource = document.querySelector("[data-slug-source]");
  const slugInput = document.querySelector("[data-slug-input]");
  let postId = getEditorPostId();
  let loadedPost = null;
  let dirty = false;
  let saving = false;
  let slugTouched = Boolean(postId);
  const deleteButton = document.querySelector("[data-delete-post]");
  if (deleteButton && !postId) deleteButton.hidden = true;

  const markDirty = () => {
    dirty = true;
    setSaveStatus("Unsaved changes");
    updateSeoPreview(form);
  };
  const markSaved = () => {
    dirty = false;
    setSaveStatus("Saved");
    updateSeoPreview(form);
  };

  slugInput.addEventListener("input", () => {
    slugTouched = true;
    markDirty();
  });
  slugSource.addEventListener("input", () => {
    if (!slugTouched) slugInput.value = slugify(slugSource.value);
    markDirty();
  });

  markdown?.addEventListener("input", () => {
    if (form.editor_mode.value === "markdown") editor.innerHTML = sanitizeRichText(marked.parse(markdown.value || ""));
    markDirty();
  });
  form.editor_mode?.addEventListener("change", () => {
    markdown.hidden = form.editor_mode.value !== "markdown";
    editor.hidden = form.editor_mode.value === "markdown";
    if (form.editor_mode.value === "markdown") markdown.value ||= htmlToMarkdown(editor.innerHTML);
    else editor.innerHTML = sanitizeRichText(marked.parse(markdown.value || ""));
    markDirty();
  });
  editor.addEventListener("input", markDirty);
  form.querySelectorAll("input, textarea, select").forEach((control) => {
    if (control.matches("[data-editor-image-input], [data-related-picker]")) return;
    control.addEventListener("input", markDirty);
    control.addEventListener("change", markDirty);
  });

  document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => {
    const command = button.dataset.command;
    const value = command === "createLink" ? prompt("Paste the URL") : button.dataset.value;
    if (value || command !== "createLink") document.execCommand(command, false, value);
    editor.focus();
    markDirty();
  }));
  document.querySelectorAll("[data-insert]").forEach((button) => button.addEventListener("click", () => {
    insertBlock(button.dataset.insert, editor);
    markDirty();
  }));
  document.querySelector("[data-template='travel-day']")?.addEventListener("click", () => {
    if (editor.textContent.trim() || markdown.value.trim()) {
      const ok = confirm("This will append the Travel Day template to the existing post body. Continue?");
      if (!ok) return;
    }
    insertTravelDayTemplate(form, editor, markdown);
    markDirty();
  });

  await hydrateRelatedPosts(form, markDirty);
  if (postId) {
    const { data, error } = await supabase.from("posts").select("*, post_categories(categories(*)), post_tags(tags(*))").eq("id", postId).single();
    if (error) setMessage(error.message, message);
    else {
      loadedPost = normalizePost(data);
      fillEditor(form, editor, markdown, loadedPost);
      maybeRestoreAutosave(form, editor, markdown, loadedPost);
    }
  }
  setupEditorImageUploads(editor, markDirty);
  setupKeyboardShortcuts(form);
  updateSeoPreview(form);
  markSaved();

  const savePost = async ({ autosave = false, publish = false, unpublish = false } = {}) => {
    if (saving) return null;
    saving = true;
    setSaveStatus(autosave ? "Saving..." : "Saving...");
    let payload;
    try {
      payload = collectPostPayload(form, editor, markdown);
    } catch (error) {
      saving = false;
      setSaveStatus(autosave ? "Autosave failed" : "Unsaved changes");
      setMessage(error.message, message);
      return null;
    }
    if (publish) {
      payload.status = "published";
      payload.published_at = form.published_at.value || new Date().toISOString();
      payload.publish_at = payload.published_at;
      payload.scheduled_for = null;
    }
    if (unpublish) {
      payload.status = "draft";
      payload.published_at = null;
      payload.publish_at = null;
      payload.scheduled_for = null;
    }
    const currentStatus = loadedPost?.status || form.status.value;
    if (autosave && postId && currentStatus !== "draft") {
      const { error } = await supabase.from("posts").update({
        autosave_payload: makeAutosavePayload(payload, form),
        autosaved_at: new Date().toISOString()
      }).eq("id", postId);
      saving = false;
      if (error) {
        setSaveStatus("Autosave failed");
        setMessage(error.message, message);
        return null;
      }
      markSaved();
      return { id: postId };
    }
    if (autosave) {
      payload.status = "draft";
      payload.published_at = null;
      payload.publish_at = null;
      payload.scheduled_for = null;
    }
    const request = postId
      ? supabase.from("posts").update(payload).eq("id", postId).select().single()
      : supabase.from("posts").insert(payload).select().single();
    const { data, error } = await request;
    saving = false;
    if (error) {
      setSaveStatus(autosave ? "Autosave failed" : "Unsaved changes");
      setMessage(error.message, message);
      return null;
    }
    try {
      await syncTaxonomy(data.id, fieldList(form.categories.value), fieldList(form.tags.value));
      await safeRefreshMediaFlags();
    } catch (syncError) {
      setMessage(syncError.message, message);
      return null;
    }
    postId = data.id;
    loadedPost = normalizePost(data);
    if (deleteButton) deleteButton.hidden = false;
    setMessage(autosave ? "" : "Saved.", message);
    markSaved();
    history.replaceState(null, "", editPostHref(data.id));
    return data;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await savePost();
  });

  document.querySelector("[data-preview-post]")?.addEventListener("click", () => previewPost(form, editor, markdown));
  document.querySelector("[data-publish-post]")?.addEventListener("click", () => {
    form.status.value = "published";
    if (!form.published_at.value) form.published_at.value = localDateTimeValue(new Date());
    savePost({ publish: true });
  });
  document.querySelector("[data-unpublish-post]")?.addEventListener("click", () => {
    form.status.value = "draft";
    form.published_at.value = "";
    savePost({ unpublish: true });
  });
  const autosaveTimer = setInterval(() => {
    if (dirty) savePost({ autosave: true });
  }, 30_000);
  window.addEventListener("beforeunload", (event) => {
    clearInterval(autosaveTimer);
    if (!dirty) return;
    savePost({ autosave: true });
    event.preventDefault();
    event.returnValue = "";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty) savePost({ autosave: true });
  });
  deleteButton?.addEventListener("click", async () => {
    if (!postId || !confirm("Delete this post?")) return;
    const { error } = await supabase.from("posts").delete().eq("id", postId);
    if (error) return setMessage(error.message, message);
    await safeRefreshMediaFlags();
    location.href = "/admin/posts/";
  });

  function setSaveStatus(value) {
    if (saveStatus) saveStatus.textContent = value;
  }

  function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        savePost();
      }
      if (event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        document.querySelector("[data-publish-post]")?.click();
      }
    });
  }
}

function getEditorPostId() {
  return new URLSearchParams(location.search).get("id") || location.pathname.match(/\/admin\/posts\/([^/]+)\/edit\/?$/)?.[1] || null;
}

function insertBlock(type, editor) {
  let html = "";
  if (type === "gallery") html = `<div class="image-gallery"><figure><img src="" alt="" loading="lazy"><figcaption>Caption</figcaption></figure></div>`;
  if (type === "checklist") html = `<ul class="checklist"><li><input type="checkbox"> Checklist item</li></ul>`;
  if (type === "table") html = `<table><tbody><tr><th>Heading</th><th>Heading</th></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table>`;
  if (type === "hr") html = `<hr>`;
  if (type === "image") {
    const url = prompt("Image URL");
    if (!url) return;
    html = `<figure><img src="${escapeHtml(url)}" alt="" loading="lazy"><figcaption>Caption</figcaption></figure>`;
  }
  if (type === "youtube") {
    const id = extractYoutubeId(prompt("YouTube URL"));
    if (!id) return;
    html = `<iframe src="https://www.youtube.com/embed/${id}" title="YouTube video" loading="lazy" allowfullscreen></iframe>`;
  }
  insertHtmlAtCursor(html, editor);
}

function insertHtmlAtCursor(html, editor) {
  if (!html) return;
  document.execCommand("insertHTML", false, html);
  editor?.focus();
}

function insertTravelDayTemplate(form, editor, markdown) {
  const title = form.title.value.trim() || "City, Country: Day X";
  const html = `
    <h2>First Impression</h2><p></p>
    <h2>Where I Stayed</h2><p></p>
    <h2>What I Did</h2><p></p>
    <h2>What Surprised Me</h2><p></p>
    <h2>Cost Breakdown</h2><p></p>
    <h2>Favorite Moment</h2><p></p>
    <h2>What I'd Do Differently</h2><p></p>
    <h2>Photos</h2><p></p>
    <h2>Final Thought</h2><p></p>
  `;
  if (!form.title.value.trim()) {
    form.title.value = title;
    form.slug.value ||= slugify(title);
  }
  if (form.editor_mode.value === "markdown") {
    markdown.value = `${markdown.value.trim()}\n\n${travelDayMarkdown()}`.trim();
    editor.innerHTML = sanitizeRichText(marked.parse(markdown.value));
    return;
  }
  insertHtmlAtCursor(html, editor);
}

function travelDayMarkdown() {
  return [
    "## First Impression",
    "## Where I Stayed",
    "## What I Did",
    "## What Surprised Me",
    "## Cost Breakdown",
    "## Favorite Moment",
    "## What I'd Do Differently",
    "## Photos",
    "## Final Thought"
  ].join("\n\n");
}

function extractYoutubeId(url) {
  return String(url || "").match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1];
}

function makeAutosavePayload(payload, form) {
  return {
    ...payload,
    categories: fieldList(form.categories.value),
    tags: fieldList(form.tags.value),
    saved_from_status: form.status.value
  };
}

function maybeRestoreAutosave(form, editor, markdown, post) {
  if (!post.autosave_payload || !post.autosaved_at) return;
  if (post.updated_at && new Date(post.autosaved_at) <= new Date(post.updated_at)) return;
  const ok = confirm("A newer autosave exists for this post. Restore it into the editor?");
  if (!ok) return;
  applyAutosavePayload(form, editor, markdown, post.autosave_payload);
}

function applyAutosavePayload(form, editor, markdown, payload) {
  Object.entries(payload).forEach(([key, value]) => {
    if (!form.elements[key] || typeof value === "object") return;
    form.elements[key].value = value || "";
  });
  form.categories.value = (payload.categories || []).join(", ");
  form.tags.value = (payload.tags || []).join(", ");
  markdown.value = payload.body_markdown || "";
  editor.innerHTML = sanitizeRichText(payload.body_html || (payload.body_markdown ? marked.parse(payload.body_markdown) : ""));
}

function updateSeoPreview(form) {
  const title = form.seo_title?.value || form.title?.value || "Post title";
  const description = form.seo_description?.value || form.meta_description?.value || form.excerpt?.value || "SEO description preview.";
  const socialTitle = form.social_title?.value || title;
  const socialDescription = form.social_description?.value || description;
  const image = form.social_image_url?.value || form.og_image_url?.value || form.featured_image_url?.value || "";
  const slug = slugify(form.slug?.value || form.title?.value || "");
  const previewUrl = document.querySelector("[data-preview-url]");
  const previewTitle = document.querySelector("[data-preview-title]");
  const previewDescription = document.querySelector("[data-preview-description]");
  const previewSocialTitle = document.querySelector("[data-preview-social-title]");
  const previewSocialDescription = document.querySelector("[data-preview-social-description]");
  const previewSocialImage = document.querySelector("[data-preview-social-image]");
  if (previewUrl) previewUrl.textContent = `${new URL(cmsConfig.siteUrl).hostname}/blog/${slug}`;
  if (previewTitle) previewTitle.textContent = title;
  if (previewDescription) previewDescription.textContent = description;
  if (previewSocialTitle) previewSocialTitle.textContent = socialTitle;
  if (previewSocialDescription) previewSocialDescription.textContent = socialDescription;
  if (previewSocialImage) {
    previewSocialImage.style.backgroundImage = image ? `url("${image}")` : "";
    previewSocialImage.textContent = image ? "" : "Social image";
  }
}

function fillEditor(form, editor, markdown, post) {
  Object.entries(post).forEach(([key, value]) => {
    if (form.elements[key] && typeof value !== "object") form.elements[key].value = value || "";
  });
  form.categories.value = post.categories.map((item) => item.name).join(", ");
  form.tags.value = post.tags.map((item) => item.name).join(", ");
  form.gallery.value = JSON.stringify(post.gallery || [], null, 2);
  form.attachments.value = JSON.stringify(post.attachments || [], null, 2);
  form.related_post_ids.value = (post.related_post_ids || []).join(", ");
  if (post.published_at) form.published_at.value = new Date(post.published_at).toISOString().slice(0, 16);
  markdown.value = post.body_markdown || "";
  editor.innerHTML = sanitizeRichText(post.body_html || (post.body_markdown ? marked.parse(post.body_markdown) : ""));
}

function collectPostPayload(form, editor, markdown) {
  const bodyMarkdown = form.editor_mode.value === "markdown" ? markdown.value.trim() : "";
  const bodyHtml = sanitizeRichText(form.editor_mode.value === "markdown" ? marked.parse(bodyMarkdown) : editor.innerHTML.trim());
  const status = form.status.value;
  if (status === "scheduled" && !form.published_at.value) {
    throw new Error("Choose a publish date before scheduling this post.");
  }
  return {
    title: form.title.value.trim(),
    slug: slugify(form.slug.value),
    subtitle: form.subtitle.value.trim() || null,
    excerpt: form.excerpt.value.trim() || null,
    body_html: bodyHtml,
    body_markdown: bodyMarkdown || null,
    author: form.author.value.trim() || "Joseph Huckabee",
    status,
    published_at: status === "draft" ? null : form.published_at.value || new Date().toISOString(),
    publish_at: status === "draft" ? null : form.published_at.value || new Date().toISOString(),
    scheduled_for: status === "scheduled" ? form.published_at.value || null : null,
    featured_image_url: form.featured_image_url.value.trim() || null,
    og_image_url: form.og_image_url.value.trim() || null,
    social_image_url: form.social_image_url.value.trim() || form.og_image_url.value.trim() || null,
    canonical_url: form.canonical_url.value.trim() || null,
    seo_title: form.seo_title.value.trim() || null,
    seo_description: form.seo_description.value.trim() || null,
    social_title: form.social_title.value.trim() || null,
    social_description: form.social_description.value.trim() || null,
    meta_description: form.meta_description.value.trim() || null,
    attachments: parseJsonField(form.attachments.value, []),
    gallery: parseJsonField(form.gallery.value, []),
    related_post_ids: fieldList(form.related_post_ids.value),
    reading_time_minutes: estimateReadTime(bodyHtml)
  };
}

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function hydrateRelatedPosts(form, markDirty = () => {}) {
  const select = form.querySelector("[data-related-picker]");
  if (!select) return;
  const { data } = await supabase.from("posts").select("id,title").order("updated_at", { ascending: false }).limit(100);
  select.innerHTML = `<option value="">Add related post</option>${(data || []).map((post) => `<option value="${post.id}">${escapeHtml(post.title)}</option>`).join("")}`;
  select.addEventListener("input", () => {
    if (!select.value) return;
    const current = fieldList(form.related_post_ids.value);
    if (!current.includes(select.value)) form.related_post_ids.value = [...current, select.value].join(", ");
    select.value = "";
    markDirty();
  });
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

function previewPost(form, editor, markdown) {
  const dialog = document.querySelector("[data-preview-dialog]");
  const content = document.querySelector("[data-preview-content]");
  const html = form.editor_mode.value === "markdown" ? marked.parse(markdown.value || "") : editor.innerHTML;
  content.innerHTML = `
    <header class="post-hero">
      <p class="eyebrow">${escapeHtml(form.author.value || "Journal")}</p>
      <h1>${escapeHtml(form.title.value || "Untitled")}</h1>
      <p>${escapeHtml(form.excerpt.value || form.subtitle.value || "")}</p>
    </header>
    <div class="post-body">${sanitizeRichText(html)}</div>
  `;
  dialog.showModal();
  document.querySelector("[data-close-preview]").onclick = () => dialog.close();
}

async function initMedia() {
  const drop = document.querySelector("[data-media-drop]");
  const input = document.querySelector("[data-media-input]");
  const grid = document.querySelector("[data-media-grid]");
  const search = document.querySelector("[data-media-search]");
  const filter = document.querySelector("[data-media-filter]");
  const folder = document.querySelector("[data-media-folder]");
  const progress = document.querySelector("[data-upload-progress]");
  grid.innerHTML = `<p class="admin-message">Loading media...</p>`;
  let media = await loadMedia();
  const render = () => renderMedia(grid, media, search.value, filter.value);
  [search, filter].forEach((control) => control.addEventListener("input", render));
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
    for (const file of files) if (await validFile(file)) list.push(file);
    progress.hidden = false;
    for (let index = 0; index < list.length; index += 1) {
      const { error } = await uploadMediaFile(list[index], folder.value || new Date().toISOString().slice(0, 10));
      if (error) alert(error.message);
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

async function uploadMediaFile(file, folderValue = "") {
  if (!await validFile(file)) return { error: new Error(`${file.name} is not allowed.`) };
  const optimized = file.type.startsWith("image/") && file.type !== "image/svg+xml" ? await optimizeImage(file) : file;
  const folderName = slugify(folderValue || new Date().toISOString().slice(0, 10));
  const path = `${folderName}/${crypto.randomUUID()}-${safeFileName(optimized.name)}`;
  const { error: uploadError } = await supabase.storage.from("media").upload(path, optimized, { upsert: false, contentType: optimized.type });
  if (uploadError) return { error: uploadError };
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  const row = {
    bucket: "media",
    path,
    url: data.publicUrl,
    name: optimized.name,
    mime_type: optimized.type,
    size_bytes: optimized.size,
    folder: folderName,
    responsive_variants: optimized.responsiveVariants || []
  };
  const { error: rowError } = await supabase.from("media").insert(row);
  if (rowError) return { error: rowError };
  return { data: row };
}

function setupEditorImageUploads(editor, markDirty) {
  const drop = document.querySelector("[data-editor-upload-drop]");
  const input = document.querySelector("[data-editor-image-input]");
  const progress = document.querySelector("[data-editor-upload-progress]");
  const message = document.querySelector("[data-editor-upload-message]");
  if (!drop || !input) return;
  input.addEventListener("change", () => uploadAndInsertImages(input.files));
  ["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("dragging");
  }));
  drop.addEventListener("drop", (event) => uploadAndInsertImages(event.dataTransfer.files));

  async function uploadAndInsertImages(files) {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      setMessage("Drop image files only.", message);
      return;
    }
    progress.hidden = false;
    setMessage("Uploading images...", message);
    for (let index = 0; index < images.length; index += 1) {
      const { data, error } = await uploadMediaFile(images[index], "post-images");
      if (error) {
        setMessage(`Upload failed: ${error.message}`, message);
        progress.hidden = true;
        return;
      }
      insertHtmlAtCursor(`<figure><img src="${escapeHtml(data.url)}" alt="" loading="lazy"><figcaption>Caption</figcaption></figure>`, editor);
      progress.value = Math.round(((index + 1) / images.length) * 100);
    }
    setMessage("Images uploaded and inserted.", message);
    progress.hidden = true;
    input.value = "";
    markDirty();
  }
}

async function optimizeImage(file) {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const maxWidth = Math.min(1800, bitmap.width);
  const scale = maxWidth / bitmap.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  const optimized = new File([blob], `${safeFileName(file.name).replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp" });
  optimized.responsiveVariants = [480, 960, 1440].filter((width) => width <= canvas.width).map((width) => ({ width, format: "webp" }));
  return optimized;
}

function safeFileName(name) {
  const extension = String(name).split(".").pop().toLowerCase();
  const base = String(name).replace(/\.[^.]+$/, "");
  return `${slugify(base) || "upload"}.${extension}`;
}

async function loadMedia() {
  const { data, error } = await supabase.from("media").select("*").order("created_at", { ascending: false });
  if (error) return [];
  return Promise.all((data || []).map(async (item) => {
    const { data: signed } = await supabase.storage.from("media").createSignedUrl(item.path, 60 * 60);
    return { ...item, display_url: signed?.signedUrl || item.url };
  }));
}

function renderMedia(grid, media, query, type) {
  const needle = query.trim().toLowerCase();
  const visible = media.filter((item) => {
    const matchesText = !needle || [item.name, item.path, item.mime_type, item.folder].join(" ").toLowerCase().includes(needle);
    const matchesType = !type || (type === "image" ? item.mime_type.startsWith("image/") : item.mime_type === "application/pdf");
    return matchesText && matchesType;
  });
  grid.innerHTML = visible.map((item) => `
    <article class="media-card">
      ${item.mime_type === "application/pdf" ? `<iframe src="${escapeHtml(item.display_url)}" title="${escapeHtml(item.name)}"></iframe>` : `<img src="${escapeHtml(item.display_url)}" alt="${escapeHtml(item.alt_text || "")}" loading="lazy">`}
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(item.folder || "Unfiled")} / ${Math.round((item.size_bytes || 0) / 1024)} KB</span>
      <div class="admin-actions">
        <button type="button" data-copy="${escapeHtml(item.url)}">Copy URL</button>
        <button type="button" data-rename-media="${item.id}">Rename</button>
        <button type="button" data-remove-media="${item.id}" data-path="${escapeHtml(item.path)}">Delete</button>
      </div>
    </article>
  `).join("") || `<p class="admin-message">No media found.</p>`;
  grid.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => navigator.clipboard.writeText(button.dataset.copy)));
  grid.querySelectorAll("[data-rename-media]").forEach((button) => button.addEventListener("click", async () => {
    const item = media.find((entry) => entry.id === button.dataset.renameMedia);
    const name = prompt("New media name", item?.name || "");
    if (!name) return;
    const { error } = await supabase.from("media").update({ name }).eq("id", button.dataset.renameMedia);
    if (error) alert(error.message);
    location.reload();
  }));
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
      social_links: parseJsonField(form.social_links.value, {}),
      seo_defaults: parseJsonField(form.seo_defaults.value, {}),
      analytics_ids: parseJsonField(form.analytics_ids.value, {}),
      contact_info: form.contact_info.value
    };
    const { error } = await supabase.from("settings").upsert(payload);
    setMessage(error ? error.message : "Settings saved.", message);
  });
}

async function initTerms(tableName) {
  const form = document.querySelector("[data-term-form]");
  const list = document.querySelector("[data-term-list]");
  const message = document.querySelector("[data-term-message]");
  const render = async () => {
    list.innerHTML = `<p class="admin-message">Loading ${tableName}...</p>`;
    const { data, error } = await supabase.from(tableName).select("*").order("name");
    if (error) return list.innerHTML = `<p class="admin-message">${escapeHtml(error.message)}</p>`;
    list.innerHTML = (data || []).map((term) => `
      <article class="admin-row">
        <div><strong>${escapeHtml(term.name)}</strong><span>${escapeHtml(term.slug)}${term.description ? ` / ${escapeHtml(term.description)}` : ""}</span></div>
        <div class="admin-actions">
          <button type="button" data-edit-term="${term.id}">Edit</button>
          <button type="button" data-delete-term="${term.id}">Delete</button>
        </div>
      </article>
    `).join("") || `<p class="admin-message">No ${tableName} yet.</p>`;
    list.querySelectorAll("[data-edit-term]").forEach((button) => button.addEventListener("click", () => {
      const term = data.find((item) => item.id === button.dataset.editTerm);
      form.id.value = term.id;
      form.name.value = term.name || "";
      form.slug.value = term.slug || "";
      if (form.description) form.description.value = term.description || "";
    }));
    list.querySelectorAll("[data-delete-term]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm(`Delete this ${tableName.slice(0, -1)}?`)) return;
      const { error } = await supabase.from(tableName).delete().eq("id", button.dataset.deleteTerm);
      if (error) setMessage(error.message, message);
      await render();
    }));
  };
  form.name.addEventListener("input", () => {
    if (!form.slug.value || !form.id.value) form.slug.value = slugify(form.name.value);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = { name: form.name.value.trim(), slug: slugify(form.slug.value || form.name.value) };
    if (form.description) payload.description = form.description.value.trim() || null;
    const request = form.id.value ? supabase.from(tableName).update(payload).eq("id", form.id.value) : supabase.from(tableName).insert(payload);
    const { error } = await request;
    setMessage(error ? error.message : "Saved.", message);
    if (!error) form.reset();
    await render();
  });
  await render();
}

function routeFields() {
  return [
    { name: "title", label: "Title", required: true },
    { name: "slug", label: "Slug", required: true },
    { name: "description", label: "Description", type: "textarea" },
    { name: "cover_image_url", label: "Cover image URL", type: "url" },
    { name: "status", label: "Status", type: "select", options: ["draft", "published"] },
    { name: "sort_order", label: "Sort order", type: "number" }
  ];
}

async function initSimpleManager(tableName, fields) {
  const form = document.querySelector("[data-simple-form]");
  const list = document.querySelector("[data-simple-list]");
  const message = document.querySelector("[data-simple-message]");
  form.innerHTML = `<input type="hidden" name="id">${fields.map(fieldTemplate).join("")}<button class="button" type="submit">Save</button><p class="admin-message" data-simple-message></p>`;
  const render = async () => {
    list.innerHTML = `<p class="admin-message">Loading records...</p>`;
    const { data, error } = await supabase.from(tableName).select("*").order("sort_order", { ascending: true });
    if (error) return list.innerHTML = `<p class="admin-message">${escapeHtml(error.message)}</p>`;
    list.innerHTML = (data || []).map((row) => managerRow(row, fields)).join("") || `<p class="admin-message">No records yet.</p>`;
    list.querySelectorAll("[data-edit-row]").forEach((button) => button.addEventListener("click", () => fillSimpleForm(form, data.find((row) => row.id === button.dataset.editRow))));
    list.querySelectorAll("[data-delete-row]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("Delete this record?")) return;
      const { error } = await supabase.from(tableName).delete().eq("id", button.dataset.deleteRow);
      if (error) setMessage(error.message, message);
      await render();
    }));
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(fields.map((field) => [field.name, readField(form, field)]));
    const request = form.id.value ? supabase.from(tableName).update(payload).eq("id", form.id.value) : supabase.from(tableName).insert(payload);
    const { error } = await request;
    setMessage(error ? error.message : "Saved.", form.querySelector("[data-simple-message]"));
    if (!error) form.reset();
    await render();
  });
  await render();
}

function fieldTemplate(field) {
  if (field.type === "textarea") return `<label>${field.label}<textarea name="${field.name}" ${field.required ? "required" : ""}></textarea></label>`;
  if (field.type === "select") return `<label>${field.label}<select name="${field.name}">${field.options.map((option) => `<option value="${option}">${option}</option>`).join("")}</select></label>`;
  const step = field.type === "number" ? "step=\"any\"" : "";
  return `<label>${field.label}<input name="${field.name}" type="${field.type || "text"}" ${step} ${field.required ? "required" : ""}></label>`;
}

function managerRow(row, fields) {
  const title = row.title || row.location_name || row.name || row.slug || row.id;
  const meta = fields.map((field) => row[field.name]).filter(Boolean).slice(1, 4).join(" / ");
  return `<article class="admin-row"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta)}</span></div><div class="admin-actions"><button type="button" data-edit-row="${row.id}">Edit</button><button type="button" data-delete-row="${row.id}">Delete</button></div></article>`;
}

function fillSimpleForm(form, row) {
  Object.entries(row || {}).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  });
}

function readField(form, field) {
  const value = form.elements[field.name].value;
  if (field.type === "number") return Number(value || 0);
  if (field.name === "is_public") return value === "true";
  return value || null;
}

async function initCheckins() {
  const fields = [
    { name: "location_name", label: "Location name", required: true },
    { name: "latitude", label: "Latitude", type: "number", required: true },
    { name: "longitude", label: "Longitude", type: "number", required: true },
    { name: "visited_at", label: "Date", type: "date", required: true },
    { name: "cover_image_url", label: "Cover image URL", type: "url" },
    { name: "journal_note", label: "Short journal note", type: "textarea" },
    { name: "related_post_slug", label: "Related blog post slug" },
    { name: "is_public", label: "Public", type: "select", options: ["true", "false"] },
    { name: "sort_order", label: "Sort order", type: "number" }
  ];
  await initSimpleManager("checkins", fields);
}

function parseJsonField(value, fallback) {
  if (!String(value || "").trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    alert("One JSON field is invalid.");
    throw new Error("Invalid JSON");
  }
}

async function safeRefreshMediaFlags() {
  try {
    await supabase.rpc("refresh_media_public_flags");
  } catch {
    /* The migration may not be applied yet in local projects. */
  }
}

function htmlToMarkdown(html) {
  return String(html || "")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "\n$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
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
