import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.NOW_ROAMING_CMS || {};

export const cmsConfig = {
  supabaseUrl: config.supabaseUrl || "",
  supabaseAnonKey: config.supabaseAnonKey || "",
  adminEmail: config.adminEmail || "",
  siteUrl: config.siteUrl || window.location.origin
};

export function hasSupabaseConfig() {
  return Boolean(cmsConfig.supabaseUrl && cmsConfig.supabaseAnonKey);
}

export const supabase = hasSupabaseConfig()
  ? createClient(cmsConfig.supabaseUrl, cmsConfig.supabaseAnonKey)
  : null;

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function estimateReadTime(html) {
  const words = String(html || "").replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

export function formatDate(value) {
  if (!value) return "Unscheduled";
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function postUrl(post) {
  return `/blog/${encodeURIComponent(post.slug)}`;
}
