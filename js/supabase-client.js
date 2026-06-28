import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.NOW_ROAMING_CMS || {};

function readJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function supabaseKeyProblem(key) {
  if (!key) return "";
  const normalizedKey = String(key).trim();
  const lowerKey = normalizedKey.toLowerCase();
  if (lowerKey.startsWith("sb_secret_") || lowerKey.includes("sb_secret_")) {
    return "The configured SUPABASE_ANON_KEY is a Supabase secret key. Replace it with the anon public or publishable browser key in Vercel and rebuild.";
  }
  const payload = readJwtPayload(key);
  if (payload?.role === "service_role" || lowerKey.includes("service_role")) {
    return "The configured SUPABASE_ANON_KEY is a service role key. Replace it with the public anon key in Vercel and rebuild.";
  }
  if (payload?.role && payload.role !== "anon") {
    return `The configured SUPABASE_ANON_KEY has role "${payload.role}". It must be the public anon key.`;
  }
  return "";
}

export const cmsConfig = {
  supabaseUrl: config.supabaseUrl || "",
  supabaseAnonKey: config.supabaseAnonKey || "",
  adminEmail: config.adminEmail || "",
  siteUrl: config.siteUrl || window.location.origin
};

export function hasSupabaseConfig() {
  return Boolean(cmsConfig.supabaseUrl && cmsConfig.supabaseAnonKey && !supabaseKeyProblem(cmsConfig.supabaseAnonKey));
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
export const supabase = hasSupabaseConfig()
  ? createClient(cmsConfig.supabaseUrl, cmsConfig.supabaseAnonKey)
  : null;