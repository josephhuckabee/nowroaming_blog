import DOMPurify from "https://esm.sh/dompurify@3.2.6";
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
const protectedPages = new Set(["dashboard", "posts", "drafts", "editor", "media", "settings", "categories", "tags", "routes", "checkins", "account"]);
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
  if (page === "account") await initAccount();
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
    .filter((post) => !needle || [post.title, post.excerpt, post.body_html, ...post.categories.map((x) => x.name), ...post.tags.map((x) => x.name)].join(" ").toLowerCase().includes(needle))
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
    if (editor.textContent.trim()) {
      const ok = confirm("This will append the Travel Day template to the existing post body. Continue?");
      if (!ok) return;
    }
    insertTravelDayTemplate(form, editor);
    markDirty();
  });

  await hydrateTaxonomyOptions();
  setupEditorAssets(form, markDirty);
  if (postId) {
    const { data, error } = await supabase.from("posts").select("*, post_categories(categories(*)), post_tags(tags(*))").eq("id", postId).single();
    if (error) setMessage(error.message, message);
    else {
      loadedPost = normalizePost(data);
      fillEditor(form, editor, loadedPost);
      maybeRestoreAutosave(form, editor, loadedPost);
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
      payload = collectPostPayload(form, editor);
    } catch (error) {
      saving = false;
      setSaveStatus(autosave ? "Autosave failed" : "Unsaved changes");
      setMessage(error.message, message);
      return null;
    }
    if (publish) {
      const now = new Date().toISOString();
      payload.status = "published";
      payload.published_at = now;
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
      const { error } = await updatePostRecord({
        autosave_payload: makeAutosavePayload(payload, form),
        autosaved_at: new Date().toISOString()
      }, postId);
      saving = false;
      if (error) {
        setSaveStatus("Autosave failed");
        setMessage("Autosave could not be stored. Try saving the draft manually.", message);
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
    const { data, error } = await savePostRecord(payload, postId);
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

  document.querySelector("[data-preview-post]")?.addEventListener("click", async () => {
    if (dirty || !postId) await savePost();
    if (postId) {
      window.open(`/blog/post/?preview=${encodeURIComponent(postId)}`, "_blank", "noopener");
      return;
    }
    previewPost(form, editor);
  });
  document.querySelector("[data-publish-post]")?.addEventListener("click", () => {
    form.status.value = "published";
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

async function savePostRecord(payload, postId) {
  const safePayload = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const request = postId
      ? supabase.from("posts").update(safePayload).eq("id", postId).select().single()
      : supabase.from("posts").insert(safePayload).select().single();
    const result = await request;
    if (!result.error) return result;
    const missing = missingColumnName(result.error.message);
    if (!missing || !(missing in safePayload)) return result;
    delete safePayload[missing];
  }
  return { data: null, error: new Error("Post save failed after removing unsupported columns.") };
}

async function updatePostRecord(payload, postId) {
  const safePayload = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabase.from("posts").update(safePayload).eq("id", postId);
    if (!result.error) return result;
    const missing = missingColumnName(result.error.message);
    if (!missing || !(missing in safePayload)) return result;
    delete safePayload[missing];
  }
  return { error: new Error("Post update failed after removing unsupported columns.") };
}

function missingColumnName(message) {
  return String(message || "").match(/'([^']+)' column/)?.[1] ||
    String(message || "").match(/column "([^"]+)"/)?.[1] ||
    String(message || "").match(/Could not find the '([^']+)'/)?.[1] ||
    "";
}

function getEditorPostId() {
  return new URLSearchParams(location.search).get("id") || location.pathname.match(/\/admin\/posts\/([^/]+)\/edit\/?$/)?.[1] || null;
}

function insertBlock(type, editor) {
  let html = "";
  if (type === "gallery") {
    document.querySelector("[data-gallery-files]")?.click();
    return;
  }
  if (type === "checklist") html = `<ul class="checklist"><li><input type="checkbox"> Checklist item</li></ul>`;
  if (type === "table") html = `<table><tbody><tr><th>Heading</th><th>Heading</th></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table>`;
  if (type === "hr") html = `<hr>`;
  if (type === "image") {
    document.querySelector("[data-editor-image-input]")?.click();
    return;
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

function insertTravelDayTemplate(form, editor) {
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
  insertHtmlAtCursor(html, editor);
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

function maybeRestoreAutosave(form, editor, post) {
  if (!post.autosave_payload || !post.autosaved_at) return;
  if (post.updated_at && new Date(post.autosaved_at) <= new Date(post.updated_at)) return;
  const ok = confirm("A newer autosave exists for this post. Restore it into the editor?");
  if (!ok) return;
  applyAutosavePayload(form, editor, post.autosave_payload);
}

function applyAutosavePayload(form, editor, payload) {
  Object.entries(payload).forEach(([key, value]) => {
    if (!form.elements[key] || typeof value === "object") return;
    form.elements[key].value = value || "";
  });
  form.categories.value = (payload.categories || []).join(", ");
  form.tags.value = (payload.tags || []).join(", ");
  editor.innerHTML = sanitizeRichText(payload.body_html || "");
}

function updateSeoPreview(form) {
  const generated = generatedMetadata(form);
  const title = form.seo_title_override?.value || generated.title;
  const description = form.seo_description_override?.value || generated.description;
  const socialTitle = form.social_title_override?.value || title;
  const socialDescription = form.social_description_override?.value || description;
  const image = form.social_image_url?.value || form.og_image_url?.value || form.featured_image_url?.value || "";
  const slug = form.slug_override?.value ? slugify(form.slug_override.value) : generated.slug;
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

function generatedMetadata(form) {
  const title = (form.title?.value || "Untitled").trim();
  const description = (form.excerpt?.value || form.subtitle?.value || plainTextFromHtml(document.querySelector("[data-rich-editor]")?.innerHTML || "")).trim().slice(0, 155) || "Now Roaming field note.";
  return {
    title,
    description,
    slug: slugify(form.slug_override?.value || form.slug?.value || title)
  };
}

function plainTextFromHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent.replace(/\s+/g, " ").trim();
}

function fillEditor(form, editor, post) {
  Object.entries(post).forEach(([key, value]) => {
    if (form.elements[key] && typeof value !== "object") form.elements[key].value = value || "";
  });
  form.categories.value = post.categories.map((item) => item.name).join(", ");
  form.tags.value = post.tags.map((item) => item.name).join(", ");
  form.gallery.value = JSON.stringify(post.gallery || [], null, 2);
  form.attachments.value = JSON.stringify(post.attachments || [], null, 2);
  if (post.publish_at || post.published_at) form.published_at.value = new Date(post.publish_at || post.published_at).toISOString().slice(0, 16);
  if (form.slug_override) form.slug_override.value = post.slug || "";
  if (form.canonical_override) form.canonical_override.value = post.canonical_url || "";
  if (form.seo_title_override) form.seo_title_override.value = post.seo_title || "";
  if (form.seo_description_override) form.seo_description_override.value = post.seo_description || post.meta_description || "";
  if (form.social_title_override) form.social_title_override.value = post.social_title || "";
  if (form.social_description_override) form.social_description_override.value = post.social_description || "";
  if (form.scheduled_publish_at) form.scheduled_publish_at.value = post.scheduled_for ? new Date(post.scheduled_for).toISOString().slice(0, 16) : "";
  document.querySelector("[data-current-post-status]").textContent = statusLabel(post);
  editor.innerHTML = sanitizeRichText(post.body_html || "");
  renderAssetPreviews(form);
}

function collectPostPayload(form, editor) {
  const bodyHtml = sanitizeRichText(editor.innerHTML.trim());
  const generated = generatedMetadata(form);
  const scheduledAt = form.scheduled_publish_at?.value || "";
  const status = scheduledAt ? "scheduled" : form.status.value;
  if (status === "scheduled" && !scheduledAt) {
    throw new Error("Choose a publish date before scheduling this post.");
  }
  form.slug.value = generated.slug;
  form.seo_title.value = form.seo_title_override?.value || generated.title;
  form.seo_description.value = form.seo_description_override?.value || generated.description;
  form.social_title.value = form.social_title_override?.value || form.seo_title.value;
  form.social_description.value = form.social_description_override?.value || form.seo_description.value;
  form.meta_description.value = form.seo_description.value;
  form.canonical_url.value = form.canonical_override?.value || "";
  form.og_image_url.value = form.featured_image_url.value || form.social_image_url.value || "";
  return {
    title: form.title.value.trim(),
    slug: generated.slug,
    subtitle: form.subtitle.value.trim() || null,
    excerpt: form.excerpt.value.trim() || null,
    body_html: bodyHtml,
    author: "Joseph Huckabee",
    status,
    published_at: status === "draft" ? null : form.published_at.value || null,
    publish_at: status === "draft" ? null : scheduledAt || form.published_at.value || null,
    scheduled_for: status === "scheduled" ? scheduledAt : null,
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
    related_post_ids: [],
    reading_time_minutes: estimateReadTime(bodyHtml)
  };
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

function statusLabel(post) {
  if (!post) return "Draft";
  if (post.status === "scheduled") return `Scheduled for ${new Date(post.publish_at || post.scheduled_for).toLocaleString()}`;
  if (post.status === "published") return `Published ${post.publish_at || post.published_at ? new Date(post.publish_at || post.published_at).toLocaleString() : ""}`;
  return "Draft";
}

async function hydrateTaxonomyOptions() {
  const [categories, tags] = await Promise.all([
    supabase.from("categories").select("name").order("name"),
    supabase.from("tags").select("name").order("name")
  ]);
  const categoryOptions = document.querySelector("[data-category-options]");
  const tagOptions = document.querySelector("[data-tag-options]");
  if (categoryOptions) categoryOptions.innerHTML = (categories.data || []).map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("");
  if (tagOptions) tagOptions.innerHTML = (tags.data || []).map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("");
}

function setupEditorAssets(form, markDirty) {
  document.querySelectorAll("[data-asset-picker]").forEach((picker) => {
    const fieldName = picker.dataset.assetPicker;
    const input = picker.querySelector("[data-asset-file]");
    const button = picker.querySelector("[data-asset-button]");
    const message = picker.querySelector("[data-asset-message]");
    const upload = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setMessage("Uploading...", message);
      const { data, error } = await uploadMediaFile(file, "post-assets");
      if (error) return setMessage(`Upload failed: ${error.message}`, message);
      form.elements[fieldName].value = data.url;
      if (fieldName === "featured_image_url" && !form.social_image_url.value) form.social_image_url.value = data.url;
      if (fieldName === "featured_image_url") form.og_image_url.value = data.url;
      setMessage("Uploaded.", message);
      renderAssetPreviews(form);
      markDirty();
    };
    button?.addEventListener("click", () => input.click());
    input?.addEventListener("change", upload);
  });

  const galleryInput = document.querySelector("[data-gallery-files]");
  document.querySelector("[data-gallery-button]")?.addEventListener("click", () => galleryInput?.click());
  galleryInput?.addEventListener("change", async () => {
    const gallery = parseJsonField(form.gallery.value, []);
    const attachments = parseJsonField(form.attachments.value, []);
    for (const file of galleryInput.files) {
      const { data, error } = await uploadMediaFile(file, file.type === "application/pdf" ? "pdfs" : "gallery");
      if (error) {
        alert(error.message);
        continue;
      }
      if (file.type === "application/pdf") attachments.push({ url: data.url, name: file.name });
      else gallery.push({ url: data.url, caption: "" });
    }
    form.gallery.value = JSON.stringify(gallery);
    form.attachments.value = JSON.stringify(attachments);
    renderAssetPreviews(form);
    markDirty();
  });
}

function renderAssetPreviews(form) {
  document.querySelectorAll("[data-asset-picker]").forEach((picker) => {
    const fieldName = picker.dataset.assetPicker;
    const url = form.elements[fieldName]?.value || "";
    const preview = picker.querySelector("[data-asset-preview]");
    if (!preview) return;
    preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="">` : `<span>No image selected</span>`;
  });
  const galleryList = document.querySelector("[data-gallery-list]");
  if (galleryList) {
    const items = [
      ...parseJsonField(form.gallery.value, []).map((item) => item.caption || "Gallery image"),
      ...parseJsonField(form.attachments.value, []).map((item) => item.name || "PDF")
    ];
    galleryList.innerHTML = items.length ? items.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : `<span>No media yet</span>`;
  }
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
  const html = editor.innerHTML;
  const gallery = parseJsonField(form.gallery.value, []);
  content.innerHTML = `
    <header class="post-hero">
      <p class="eyebrow">Journal</p>
      <h1>${escapeHtml(form.title.value || "Untitled")}</h1>
      <p>${escapeHtml(form.excerpt.value || form.subtitle.value || "")}</p>
    </header>
    ${form.featured_image_url.value ? `<img class="post-featured-image" src="${escapeHtml(form.featured_image_url.value)}" alt="">` : ""}
    <div class="post-body">${sanitizeRichText(html)}</div>
    ${gallery.length ? `<div class="image-gallery">${gallery.map((item) => `<figure><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || "")}"><figcaption>${escapeHtml(item.caption || "")}</figcaption></figure>`).join("")}</div>` : ""}
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
    is_public: true,
    folder: folderName
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

async function initAccount() {
  const form = document.querySelector("[data-account-form]");
  const message = document.querySelector("[data-account-message]");
  const { data } = await supabase.auth.getUser();
  if (data.user) form.email.value = data.user.email || "";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.password.value !== form.confirm_password.value) {
      setMessage("Passwords do not match.", message);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: form.password.value });
    setMessage(error ? error.message : "Password updated.", message);
    if (!error) {
      form.password.value = "";
      form.confirm_password.value = "";
    }
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
  await detectCheckInsTable();
  const form = document.querySelector("[data-checkin-form]");
  const list = document.querySelector("[data-checkin-list]");
  const message = document.querySelector("[data-checkin-message]");
  const mapMessage = document.querySelector("[data-checkin-map-message]");
  const coverInput = document.querySelector("[data-checkin-cover-file]");
  const coverPreview = document.querySelector("[data-checkin-cover-preview]");
  const postsByTitle = new Map();
  form.visited_at.value ||= new Date().toISOString().slice(0, 10);

  const posts = await supabase.from("posts").select("title,slug").order("updated_at", { ascending: false }).limit(200);
  document.querySelector("[data-checkin-post-options]").innerHTML = (posts.data || []).map((post) => {
    postsByTitle.set(post.title, post.slug);
    return `<option value="${escapeHtml(post.title)}"></option>`;
  }).join("");

  let marker;
  if (!window.L) {
    setMessage("Leaflet did not load. Check the network/CSP settings.", mapMessage);
    return;
  }
  const map = window.L.map(document.querySelector("[data-checkin-map]")).setView([20, 0], 2);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  map.on("click", (event) => setCheckinCoordinates(event.latlng.lat, event.latlng.lng));

  document.querySelector("[data-use-current-location]")?.addEventListener("click", () => {
    if (!navigator.geolocation) return setMessage("Current location is not available in this browser.", mapMessage);
    navigator.geolocation.getCurrentPosition((position) => {
      setCheckinCoordinates(position.coords.latitude, position.coords.longitude);
      map.setView([position.coords.latitude, position.coords.longitude], 11);
    }, (error) => setMessage(error.message, mapMessage));
  });

  document.querySelector("[data-search-location]")?.addEventListener("click", async () => {
    const query = document.querySelector("[data-checkin-location-search]").value.trim();
    if (!query) return;
    setMessage("Searching...", mapMessage);
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
    const [result] = await response.json();
    if (!result) return setMessage("No place found.", mapMessage);
    form.location_name.value ||= result.display_name.split(",").slice(0, 2).join(",");
    setCheckinCoordinates(Number(result.lat), Number(result.lon));
    map.setView([Number(result.lat), Number(result.lon)], 10);
  });

  document.querySelector("[data-checkin-cover-button]")?.addEventListener("click", () => coverInput.click());
  coverInput?.addEventListener("change", async () => {
    const files = [...(coverInput.files || [])].filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    const coverMessage = document.querySelector("[data-checkin-cover-message]");
    const photos = parseJsonField(form.photos.value, []);
    setMessage("Uploading photos...", coverMessage);
    for (const file of files) {
      const { data, error } = await uploadMediaFile(file, "check-ins");
      if (error) return setMessage(`Upload failed: ${error.message}`, coverMessage);
      photos.push({ url: data.url, name: file.name });
      form.cover_image_url.value ||= data.url;
    }
    form.photos.value = JSON.stringify(photos);
    renderCheckinCover();
    setMessage("Uploaded.", coverMessage);
  });

  document.querySelector("[data-new-checkin]")?.addEventListener("click", () => {
    form.reset();
    form.visited_at.value = new Date().toISOString().slice(0, 10);
    form.is_public.value = "true";
    form.sort_order.value = "0";
    form.cover_image_url.value = "";
    form.photos.value = "[]";
    form.related_post_slug.value = "";
    if (marker) marker.remove();
    marker = null;
    renderCheckinCover();
  });

  form.related_post_search.addEventListener("change", () => {
    form.related_post_slug.value = postsByTitle.get(form.related_post_search.value) || "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.latitude.value || !form.longitude.value) return setMessage("Drop a pin or search a place before saving.", message);
    const payload = {
      location_name: form.location_name.value.trim(),
      latitude: Number(form.latitude.value),
      longitude: Number(form.longitude.value),
      visited_at: form.visited_at.value || new Date().toISOString().slice(0, 10),
      cover_image_url: form.cover_image_url.value || null,
      photos: parseJsonField(form.photos.value, []),
      journal_note: form.journal_note.value.trim() || null,
      related_post_slug: form.related_post_slug.value || postsByTitle.get(form.related_post_search.value) || null,
      is_public: form.is_public.value === "true",
      sort_order: Number(form.sort_order.value || 0)
    };
    const { error } = await saveCheckinRecord(payload, form.id.value);
    setMessage(error ? error.message : "Check-in saved.", message);
    if (!error) await render();
  });

  function setCheckinCoordinates(lat, lng) {
    form.latitude.value = lat.toFixed(6);
    form.longitude.value = lng.toFixed(6);
    if (marker) marker.setLatLng([lat, lng]);
    else marker = window.L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const point = marker.getLatLng();
      form.latitude.value = point.lat.toFixed(6);
      form.longitude.value = point.lng.toFixed(6);
    });
    setMessage(`Pin set: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, mapMessage);
  }

  function renderCheckinCover() {
    const photos = parseJsonField(form.photos.value, []);
    coverPreview.innerHTML = photos.length
      ? photos.map((photo) => `<img src="${escapeHtml(photo.url || photo)}" alt="">`).join("")
      : form.cover_image_url.value ? `<img src="${escapeHtml(form.cover_image_url.value)}" alt="">` : `<span>No photos selected</span>`;
  }

  async function render() {
    list.innerHTML = `<p class="admin-message">Loading check-ins...</p>`;
    const { data, error } = await checkInsFrom().select("*").order("sort_order", { ascending: true });
    if (error) return list.innerHTML = `<p class="admin-message">${escapeHtml(error.message)}</p>`;
    list.innerHTML = (data || []).map((item) => `
      <article class="admin-row">
        <div><strong>${escapeHtml(item.location_name)}</strong><span>${escapeHtml(item.visited_at)} / ${item.is_public ? "Public" : "Private"}</span></div>
        <div class="admin-actions">
          <button type="button" data-edit-checkin="${item.id}">Edit</button>
          <button type="button" data-delete-checkin="${item.id}">Delete</button>
        </div>
      </article>
    `).join("") || `<p class="admin-message">No check-ins yet. Drop a pin to create the first one.</p>`;
    list.querySelectorAll("[data-edit-checkin]").forEach((button) => button.addEventListener("click", () => {
      const item = data.find((row) => row.id === button.dataset.editCheckin);
      Object.entries(item).forEach(([key, value]) => {
        if (!form.elements[key]) return;
        form.elements[key].value = typeof value === "object" && value !== null ? JSON.stringify(value) : value ?? "";
      });
      form.is_public.value = String(item.is_public);
      const post = [...postsByTitle].find(([, slug]) => slug === item.related_post_slug);
      form.related_post_search.value = post?.[0] || "";
      setCheckinCoordinates(Number(item.latitude), Number(item.longitude));
      map.setView([Number(item.latitude), Number(item.longitude)], 8);
      renderCheckinCover();
    }));
    list.querySelectorAll("[data-delete-checkin]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("Delete this check-in?")) return;
      const { error } = await checkInsFrom().delete().eq("id", button.dataset.deleteCheckin);
      setMessage(error ? error.message : "Check-in deleted.", message);
      if (!error) await render();
    }));
  }

  renderCheckinCover();
  await render();
}

let activeCheckInsTable = "check_ins";

function checkInsFrom() {
  return supabase.from(activeCheckInsTable);
}

async function detectCheckInsTable() {
  const first = await supabase.from("check_ins").select("id").limit(1);
  activeCheckInsTable = first.error ? "checkins" : "check_ins";
}

async function saveCheckinRecord(payload, checkinId) {
  const safePayload = { ...payload };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const request = checkinId ? checkInsFrom().update(safePayload).eq("id", checkinId) : checkInsFrom().insert(safePayload);
    const result = await request;
    if (!result.error) return result;
    const missing = missingColumnName(result.error.message);
    if (!missing || !(missing in safePayload)) return result;
    delete safePayload[missing];
  }
  return { error: new Error("Check-in save failed after removing unsupported columns.") };
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
