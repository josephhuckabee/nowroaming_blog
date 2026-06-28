const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(process.cwd(), ".env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function readJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function assertPublicAnonKey(key) {
  if (!key) return "";
  const payload = readJwtPayload(key);
  if (payload?.role === "service_role" || String(key).toLowerCase().includes("service_role")) {
    throw new Error("SUPABASE_ANON_KEY contains a service role key. Replace it with the public anon key before building.");
  }
  if (payload?.role && payload.role !== "anon") {
    throw new Error(`SUPABASE_ANON_KEY must be the public anon key. Found Supabase role "${payload.role}".`);
  }
  return key;
}

module.exports = {
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseAnonKey: assertPublicAnonKey(process.env.SUPABASE_ANON_KEY || ""),
  adminEmail: process.env.ADMIN_EMAIL || "",
  siteUrl: process.env.SITE_URL || "https://youarenowroaming.com"
};
