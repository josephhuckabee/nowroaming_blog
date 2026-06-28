import { cmsConfig, hasSupabaseConfig, supabase } from "./supabase-client.js";

const adminNav = document.querySelector("[data-admin-nav]");
const logoutButton = document.querySelector("[data-global-admin-logout]");

if (hasSupabaseConfig() && adminNav) {
  initAdminNav();
}

async function initAdminNav() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return;
  const email = session.user.email?.toLowerCase();
  if (cmsConfig.adminEmail && email !== cmsConfig.adminEmail.toLowerCase()) return;
  const { data: profile, error } = await supabase.from("users").select("role").eq("id", session.user.id).maybeSingle();
  if (!error && profile?.role === "admin") adminNav.hidden = false;
}

logoutButton?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.href = "/admin/login/";
});
