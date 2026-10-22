/**
 * Store Owner Dashboard — status panel, BI charts, settings form.
 * Works in live Telegram mode and in demo mode (normal browser).
 */
(function () {
  "use strict";

  const TMA = window.RetailTMA;
  const charts = window.RetailCharts;
  let timers = [];
  let chartInstances = [];
  let lastState = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------- helpers
  function toast(msg, ok = true) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast show " + (ok ? "toast-ok" : "toast-err");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function fmtEpoch(sec) {
    if (!sec) return "—";
    return new Date(sec * 1000).toLocaleString();
  }

  function statusBadgeClass(status) {
    return {
      Normal: "badge-green", Congested: "badge-amber", Critical: "badge-red", Blocked: "badge-gray",
    }[status] || "badge-gray";
  }

  function renderSkeleton(on) {
    ["status-panel", "bi-panel"].forEach((id) => {
      const el = $(id);
      if (el) el.classList.toggle("skeleton", !!on);
    });
  }

  // ------------------------------------------------------------------ state
  async function fetchState() {
    const cfg = await TMA.config.get();
    if (!TMA.isDemo && cfg.bot_token && cfg.state_channel_id) {
      const state = await TMA.botApi.getPinnedState(cfg.bot_token, cfg.state_channel_id);
      if (state) {
        lastState = state;
        await TMA.mirrorState(state);
        return state;
      }
    }
    if (TMA.isDemo) {
      lastState = TMA.demoTick();
      return lastState;
    }
    // Live but unconfigured: try the CloudStorage mirror of the last state.
    try {
      const mirror = await TMA.store.getItems(TMA.MIRROR_KEYS);
      if (mirror.current_status) {
        return {
          type: "state",
          updated_at: null,
          subscription_expiry: mirror.subscription_expiry ? Number(mirror.subscription_expiry) : null,
          current_status: JSON.parse(mirror.current_status),
          last_analytics_report: JSON.parse(mirror.last_analytics_report || "{}"),
        };
      }
    } catch {}
    return null;
  }

  // ---------------------------------------------------------------- render
  function renderStatus(state) {
    const st = (state && state.current_status) || {};
    $("status-badge").textContent = st.status || "Unknown";
    $("status-badge").className = "badge " + statusBadgeClass(st.status);
    $("status-count").textContent = st.count != null ? st.count : "—";
    $("status-index").textContent = st.congestion_index != null ? st.congestion_index : "—";
    $("status-updated").textContent = "Updated " + (st.timestamp ? fmtEpoch(st.timestamp) : "never");
    const alertEl = $("status-alert");
    if (st.alert) {
      alertEl.textContent = "⚠ " + st.alert;
      alertEl.classList.remove("hidden");
    } else {
      alertEl.classList.add("hidden");
    }
    const expiry = $("subscription-line");
    if (expiry && state) {
      const exp = state.subscription_expiry;
      expiry.textContent = exp
        ? "Subscription until " + fmtEpoch(exp) + (exp * 1000 < Date.now() ? " — EXPIRED" : "")
        : "No subscription expiry set";
      expiry.className = exp && exp * 1000 < Date.now() ? "text-red-500 text-sm" : "text-sm opacity-70";
    }
  }

  function renderBI(report) {
    if (!report) {
      $("bi-empty").classList.remove("hidden");
      return;
    }
    $("bi-empty").classList.add("hidden");
    $("kpi-footfall").textContent = report.footfall_today != null ? report.footfall_today : "—";
    $("kpi-peak").textContent = report.peak_hour || "—";
    $("kpi-efficiency").textContent = report.efficiency || "—";
    $("kpi-gaps").textContent = report.staffing_gaps != null ? report.staffing_gaps : "—";
    const trendEl = $("kpi-trend");
    const t = report.trend_pct_vs_yesterday;
    if (t != null) {
      trendEl.textContent = (t >= 0 ? "▲ +" : "▼ ") + t + "% vs yesterday";
      trendEl.className = "text-sm " + (t >= 0 ? "text-green-500" : "text-red-500");
    } else trendEl.textContent = "";
    chartInstances.forEach((c) => { try { c.destroy(); } catch {} });
    chartInstances = [
      charts.buildPeakHoursChart("chart-peak", report.peak_hour_distribution),
      charts.buildTrendChart("chart-trend", report),
    ].filter(Boolean);
  }

  async function refresh() {
    renderSkeleton(true);
    try {
      const state = await fetchState();
      renderStatus(state);
      renderBI(state && state.last_analytics_report);
      $("conn-state").textContent = TMA.isDemo ? "Demo mode (mock data)" : "Live · channel bus";
    } catch (err) {
      toast("Could not load state: " + err.message, false);
      $("conn-state").textContent = "Live · last load failed";
    } finally {
      renderSkeleton(false);
    }
  }

  // -------------------------------------------------------------- settings
  function cameraRows() {
    return Array.from(document.querySelectorAll("[data-cam-row]")).map((row) => ({
      id: row.querySelector(".cam-id").value.trim() || ("cam" + Math.floor(Math.random() * 1e4)),
      url: row.querySelector(".cam-url").value.trim(),
      role: row.querySelector(".cam-role").value || "general",
    })).filter((c) => c.url);
  }

  function addCameraRow(cam) {
    cam = cam || { id: "", url: "", role: "general" };
    const row = document.createElement("div");
    row.className = "flex gap-2 items-center";
    row.setAttribute("data-cam-row", "");
    row.innerHTML =
      '<input class="cam-id input w-24" placeholder="id" value="' + esc(cam.id) + '">' +
      '<input class="cam-url input flex-1" placeholder="rtsp://user:pass@ip:554/stream" value="' + esc(cam.url) + '">' +
      '<select class="cam-role input w-28">' +
      ["entrance", "cashier", "aisle", "general"].map((r) =>
        '<option value="' + r + '"' + (r === (cam.role || "general") ? " selected" : "") + ">" + r + "</option>").join("") +
      "</select>" +
      '<button class="btn btn-ghost" data-cam-remove>✕</button>';
    row.querySelector("[data-cam-remove]").addEventListener("click", () => row.remove());
    $("camera-list").appendChild(row);
  }

  async function loadSettingsForm() {
    const cfg = await TMA.config.get();
    ["bot_token", "state_channel_id", "admin_id", "store_capacity", "staffing_threshold", "refresh_seconds"]
      .forEach((k) => { const el = $(k); if (el) el.value = cfg[k] || ""; });
    $("prompt-input").value = cfg.ai_target_prompt || "";
    $("camera-list").innerHTML = "";
    const cams = cfg.cctv_rtsp_urls && cfg.cctv_rtsp_urls.length ? cfg.cctv_rtsp_urls : [{ id: "cam1", url: "", role: "entrance" }];
    cams.forEach(addCameraRow);
  }

  async function saveSettings() {
    const cctv_rtsp_urls = cameraRows();
    if (!cctv_rtsp_urls.length) { toast("Add at least one camera URL", false); return; }
    const patch = {
      bot_token: $("bot_token").value.trim(),
      state_channel_id: $("state_channel_id").value.trim(),
      admin_id: $("admin_id").value.trim(),
      store_capacity: $("store_capacity").value.trim(),
      staffing_threshold: $("staffing_threshold").value.trim(),
      refresh_seconds: $("refresh_seconds").value.trim() || "30",
      ai_target_prompt: $("prompt-input").value.trim(),
      cctv_rtsp_urls,
    };
    await TMA.config.set(patch);
    try {
      const via = await TMA.pushEnvelope("set_config", {
        cctv_rtsp_urls,
        ai_target_prompt: patch.ai_target_prompt,
      });
      // CloudStorage mirror under the KB keys (visible instantly on reopen)
      try { await TMA.store.setItems({ cctv_rtsp_urls: JSON.stringify(cctv_rtsp_urls), ai_target_prompt: patch.ai_target_prompt }); } catch {}
      TMA.haptic("success");
      toast("Saved — pushed to core via " + (via === "api" ? "channel" : "sendData"));
      scheduleRefresh();
    } catch (err) {
      TMA.haptic("error");
      toast("Saved locally, but push failed: " + err.message, false);
    }
  }

  // ------------------------------------------------------------------ tabs
  function switchTab(name) {
    document.querySelectorAll("[data-tab-panel]").forEach((p) => p.classList.add("hidden"));
    document.querySelectorAll("[data-tab-btn]").forEach((b) => b.classList.remove("tab-active"));
    const panel = document.querySelector('[data-tab-panel="' + name + '"]');
    const btn = document.querySelector('[data-tab-btn="' + name + '"]');
    if (panel) panel.classList.remove("hidden");
    if (btn) btn.classList.add("tab-active");
    if (name === "settings") loadSettingsForm();
  }

  function scheduleRefresh() {
    timers.forEach(clearInterval);
    const seconds = Math.max(10, parseInt($("refresh_seconds") && $("refresh_seconds").value || "30", 10) || 30);
    timers.push(setInterval(refresh, seconds * 1000));
  }

  // ------------------------------------------------------------------- boot
  document.addEventListener("DOMContentLoaded", async () => {
    TMA.init();
    document.querySelectorAll("[data-tab-btn]").forEach((b) =>
      b.addEventListener("click", () => switchTab(b.getAttribute("data-tab-btn"))));
    $("add-camera").addEventListener("click", () => addCameraRow());
    $("save-settings").addEventListener("click", saveSettings);
    if (TMA.isDemo) {
      const banner = $("demo-banner");
      if (banner) banner.classList.remove("hidden");
    }
    await refresh();
    scheduleRefresh();
  });
})();
