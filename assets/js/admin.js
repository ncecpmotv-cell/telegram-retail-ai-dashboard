/**
 * Admin Panel — subscription manager + fleet monitor.
 * Guarded by the ADMIN_ID configured in Settings (client-side check;
 * demo mode always allows, and the core additionally validates the
 * set_subscription envelope's user_id against its own ADMIN_ID).
 */
(function () {
  "use strict";

  const TMA = window.RetailTMA;
  const USERS_KEY = "retail_ai_users";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtEpoch = (sec) => (sec ? new Date(sec * 1000).toLocaleString() : "—");

  function toast(msg, ok = true) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast show " + (ok ? "toast-ok" : "toast-err");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  async function isAdmin() {
    if (TMA.isDemo) return true;
    const cfg = await TMA.config.get();
    return !!cfg.admin_id && String(cfg.admin_id) === TMA.currentUserId();
  }

  // --------------------------------------------------------------- users
  async function loadUsers() {
    try {
      const raw = await TMA.store.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  async function saveUsers(users) {
    await TMA.store.setItem(USERS_KEY, JSON.stringify(users));
  }

  function renderUsers(users) {
    const list = $("user-list");
    list.innerHTML = "";
    if (!users.length) {
      list.innerHTML = '<div class="text-sm opacity-60 p-3">No users yet — add a user below.</div>';
      return;
    }
    users.forEach((u, idx) => {
      const expired = u.expiry && u.expiry * 1000 < Date.now();
      const row = document.createElement("div");
      row.className = "flex items-center gap-2 p-3 rounded-xl bg-white/5";
      row.innerHTML =
        '<div class="flex-1 min-w-0">' +
        '<div class="font-medium truncate">' + esc(u.name || ("user " + u.user_id)) + "</div>" +
        '<div class="text-xs opacity-60">id ' + esc(u.user_id) + " · until " + fmtEpoch(u.expiry) + "</div>" +
        "</div>" +
        '<span class="badge ' + (expired ? "badge-red" : "badge-green") + '">' + (expired ? "Expired" : "Active") + "</span>" +
        '<button class="btn btn-ghost" data-rm="' + idx + '">✕</button>';
      row.querySelector("[data-rm]").addEventListener("click", async () => {
        users.splice(idx, 1);
        await saveUsers(users);
        renderUsers(users);
      });
      list.appendChild(row);
    });
  }

  function initUserForm(users) {
    $("add-user").addEventListener("click", async () => {
      const userId = $("new-user-id").value.trim();
      const name = $("new-user-name").value.trim();
      if (!userId) { toast("Enter the user's Telegram id", false); return; }
      if (users.some((u) => String(u.user_id) === userId)) { toast("User already listed", false); return; }
      users.push({ user_id: userId, name: name || ("user " + userId), expiry: null });
      await saveUsers(users);
      renderUsers(users);
      $("new-user-id").value = ""; $("new-user-name").value = "";
      TMA.haptic("success");
      toast("User added (local list — stored in CloudStorage)");
    });

    $("push-subscription").addEventListener("click", async () => {
      const userId = $("sub-user-id").value.trim() || ($("new-user-id").value.trim());
      const days = parseInt($("sub-days").value || "30", 10);
      if (!userId) { toast("Enter the user_id to grant subscription to", false); return; }
      const expiry = Math.floor(Date.now() / 1000) + days * 86400;
      try {
        const via = await TMA.pushEnvelope("set_subscription", { user_id: userId, subscription_expiry: expiry });
        const entry = users.find((u) => String(u.user_id) === userId);
        if (entry) {
          entry.expiry = expiry;
          await saveUsers(users);
          renderUsers(users);
        }
        try { await TMA.store.setItems({ subscription_expiry: String(expiry) }); } catch {}
        TMA.haptic("success");
        toast("Subscription pushed (" + days + " days) via " + (via === "api" ? "channel" : "sendData"));
      } catch (err) {
        TMA.haptic("error");
        toast("Push failed: " + err.message, false);
      }
    });

    ["30", "90", "365"].forEach((days) => {
      const btn = $("quick-" + days);
      if (btn) btn.addEventListener("click", () => {
        $("sub-days").value = days;
        $("push-subscription").click();
      });
    });
  }

  // ------------------------------------------------------------- fleet
  async function renderFleet() {
    const el = $("fleet-card");
    const cfg = await TMA.config.get();
    if (!TMA.isDemo && !(cfg.bot_token && cfg.state_channel_id)) {
      el.innerHTML = '<div class="text-sm opacity-60 p-3">Configure BOT_TOKEN + channel in Settings first.</div>';
      return;
    }
    let state = null;
    try {
      state = TMA.isDemo
        ? TMA.demoTick()
        : await TMA.botApi.getPinnedState(cfg.bot_token, cfg.state_channel_id);
    } catch (err) {
      el.innerHTML = '<div class="text-sm text-red-400 p-3">Fleet read failed: ' + esc(err.message) + "</div>";
      return;
    }
    const st = (state && state.current_status) || {};
    const badge = { Normal: "badge-green", Congested: "badge-amber", Critical: "badge-red", Blocked: "badge-gray" }[st.status] || "badge-gray";
    el.innerHTML =
      '<div class="flex items-center justify-between">' +
      '<div><div class="font-medium">Store device</div>' +
      '<div class="text-xs opacity-60">channel ' + esc(cfg.state_channel_id || "(unset)") + "</div></div>" +
      '<span class="badge ' + badge + '">' + esc(st.status || "Unknown") + "</span></div>" +
      '<div class="grid grid-cols-3 gap-2 mt-3 text-center">' +
      '<div><div class="text-2xl font-bold">' + esc(st.count != null ? st.count : "—") + '</div><div class="text-xs opacity-60">people</div></div>' +
      '<div><div class="text-2xl font-bold">' + (state ? fmtEpoch(state.updated_at).split(",")[1] || "—" : "—") + '</div><div class="text-xs opacity-60">last seen</div></div>' +
      '<div><div class="text-2xl font-bold">' + (state && state.subscription_expiry ? fmtEpoch(state.subscription_expiry).split(",")[0] : "—") + '</div><div class="text-xs opacity-60">expiry</div></div>' +
      "</div>";
  }

  // --------------------------------------------------------------- boot
  document.addEventListener("DOMContentLoaded", async () => {
    TMA.init();
    if (TMA.isDemo) $("demo-banner").classList.remove("hidden");
    if (!(await isAdmin())) {
      document.body.innerHTML =
        '<div class="p-6 text-center"><div class="text-2xl mb-2">🔒</div>' +
        '<p class="font-medium">Admins only.</p>' +
        '<p class="text-sm opacity-60 mt-1">Your Telegram id is not the configured ADMIN_ID.</p></div>';
      return;
    }
    const users = await loadUsers();
    renderUsers(users);
    initUserForm(users);
    await renderFleet();
    $("refresh-fleet").addEventListener("click", renderFleet);
  });
})();
