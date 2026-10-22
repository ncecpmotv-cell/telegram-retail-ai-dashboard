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
  let lastSource = null;

  const $ = (id) => document.getElementById(id);
  const T = (window.RetailI18n && window.RetailI18n.t) || ((k) => k);
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
    // Live channel-bus read works in ANY browser (Bot API is CORS-open) —
    // try it first whenever a token + channel are configured.
    if (cfg.bot_token && cfg.state_channel_id) {
      try {
        const state = await TMA.botApi.getPinnedState(cfg.bot_token, cfg.state_channel_id, cfg.bridge_secret);
        if (state) {
          lastState = state;
          await TMA.mirrorState(state);
          lastSource = "live";
          return state;
        }
      } catch (err) {
        toast("Channel read failed: " + err.message, false);
      }
    }
    if (TMA.isDemo) {
      lastState = TMA.demoTick();
      lastSource = "demo";
      return lastState;
    }
    // Live Telegram but unconfigured: try the CloudStorage mirror of the last state.
    try {
      const mirror = await TMA.store.getItems(TMA.MIRROR_KEYS);
      if (mirror.current_status) {
        lastSource = "mirror";
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
    const nowMs = Date.now();
    const stMs = st.timestamp ? st.timestamp * 1000 : 0;
    const minsAgo = stMs ? Math.max(0, Math.round((nowMs - stMs) / 60000)) : null;
    const offline = minsAgo !== null && minsAgo > 10;
    $("status-badge").textContent = offline ? T("deviceOffline") : (st.status || "Unknown");
    $("status-badge").className = "badge " + (offline ? "badge-gray" : statusBadgeClass(st.status));
    $("status-count").textContent = st.count != null ? st.count : "—";
    $("status-index").textContent = st.congestion_index != null ? st.congestion_index : "—";
    $("status-updated").textContent = st.timestamp
      ? (offline ? T("deviceLastSeen") + " " + minsAgo + " " + T("minutesAgo") : T("updated") + " " + fmtEpoch(st.timestamp))
      : T("neverUpdated");
    const dev = state && state.device;
    const dm = $("device-metrics");
    if (dm) {
      dm.textContent = dev
        ? (T("inferenceMs") + ": " + (dev.last_inference_ms != null ? dev.last_inference_ms : "—") +
           " · " + T("uptimeMin") + ": " + Math.floor((dev.uptime_seconds || 0) / 60) +
           " · " + T("infOk") + ": " + (dev.inference_ok || 0) + "/" + ((dev.inference_ok || 0) + (dev.inference_fail || 0)))
        : "";
    }
    renderOps(state);

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

  /** Cafe-owner operational view: zones, staffing plan, camera health. */
  function renderOps(state) {
    const report = (state && state.last_analytics_report) || {};
    // Zones
    const zg = $("zones-grid");
    if (zg) {
      zg.innerHTML = "";
      const zones = report.zones || {};
      const ids = Object.keys(zones);
      if (ids.length) {
        ids.forEach((id) => {
          const z = zones[id];
          const div = document.createElement("div");
          div.className = "p-2 rounded-lg bg-white/5";
          div.innerHTML =
            '<div class="text-xs opacity-60 truncate">📷 ' + esc(id) + "</div>" +
            '<div class="font-semibold">' + esc(z.last_count) + " " + T("people") + "</div>" +
            '<div class="text-xs opacity-60">' + T("footfallToday") + ": " + esc(z.footfall) + "</div>";
          zg.appendChild(div);
        });
      }
    }
    // Staffing plan
    const sp = $("staffing-plan");
    if (sp) {
      const plan = (report.staffing_plan || []).filter((p) => p.recommended_staff > 0);
      sp.innerHTML = plan.length
        ? '<div class="text-sm font-semibold mt-1 mb-2">👥 ' + T("recommendedStaffing") + "</div>"
        : "";
      const maxStaff = plan.length ? Math.max.apply(null, plan.map((p) => p.recommended_staff)) : 1;
      plan.forEach((p) => {
        const row = document.createElement("div");
        row.className = "flex items-center gap-2 mb-1 text-xs";
        const hh = String(p.hour).padStart(2, "0") + ":00";
        const width = Math.round((p.recommended_staff / maxStaff) * 100);
        row.innerHTML =
          '<div class="w-12 opacity-70">' + hh + "</div>" +
          '<div class="flex-1 h-3 rounded bg-white/5 overflow-hidden">' +
          '<div class="h-full rounded" style="width:' + width + '%;background:var(--tg-theme-button-color,#2ea6ff)"></div></div>' +
          '<div class="w-16">' + esc(p.recommended_staff) + " " + T("staffNeeded") + "</div>";
        sp.appendChild(row);
      });
    }
    // Camera health
    const ch = $("camera-health");
    if (ch) {
      const health = (state && state.device && state.device.cameras_health) || {};
      const ids = Object.keys(health);
      ch.textContent = ids.length
        ? T("camHealth") + ": " + ids.map((id) => {
            const h = health[id];
            const icon = h.fail === 0 ? "🟢" : (h.ok >= h.fail ? "🟡" : "🔴");
            return icon + " " + id + " (" + h.ok + "/" + (h.ok + h.fail) + ")";
          }).join(" · ")
        : "";
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
      const labels = {
        live: T("connLive"),
        mirror: T("connMirror"),
        demo: T("connDemo"),
      };
      $("conn-state").textContent = labels[lastSource] || labels.demo;
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
    ["bot_token", "state_channel_id", "admin_id", "store_capacity", "staffing_threshold", "refresh_seconds", "bridge_secret"]
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
      bridge_secret: $("bridge_secret").value.trim(),
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
      const caveat = (via === "api" && TMA.isDemo)
        ? " (daemon only receives it if this is a RELAY bot token)"
        : "";
      toast("Saved — pushed to core via " + (via === "api" ? "channel" : "sendData") + caveat);
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
    if (window.RetailI18n) window.RetailI18n.apply();
    const langBtn = document.getElementById("lang-toggle");
    if (langBtn && window.RetailI18n) {
      langBtn.addEventListener("click", () => {
        window.RetailI18n.setLang(window.RetailI18n.lang() === "ar" ? "en" : "ar");
      });
    }
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
