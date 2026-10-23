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
  let cachedCfg = null;

  const $ = (id) => document.getElementById(id);
  const T = (window.RetailI18n && window.RetailI18n.t) || ((k) => k);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /** Translate with {placeholder} interpolation, e.g. tf("actRush", {n: 3, h: "14:00"}). */
  const tf = (key, vars) => T(key).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m));

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
    cachedCfg = cfg;
    const channel = TMA.activeChannel(cfg);
    // Live channel-bus read works in ANY browser (Bot API is CORS-open) —
    // try it first whenever a token + channel are configured.
    if (cfg.bot_token && channel) {
      try {
        const state = await TMA.botApi.getPinnedState(cfg.bot_token, channel, cfg.bridge_secret);
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
    renderCapacity(state);
    renderActions(state);
    renderRushForecast(state);
    renderRecentGaps(state);

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
      // Rank zones by today's footfall so the busiest area floats to the top.
      const ids = Object.keys(zones).sort((a, b) => (zones[b].footfall || 0) - (zones[a].footfall || 0));
      const maxFoot = ids.length ? Math.max(1, Math.max.apply(null, ids.map((i) => zones[i].footfall || 0))) : 1;
      if (ids.length) {
        ids.forEach((id, rank) => {
          const z = zones[id];
          const div = document.createElement("div");
          div.className = "p-2 rounded-lg bg-white/5" + (rank === 0 ? " zone-busiest" : "");
          const width = Math.round(((z.footfall || 0) / maxFoot) * 100);
          div.innerHTML =
            '<div class="flex items-center justify-between gap-1">' +
              '<div class="text-xs opacity-60 truncate min-w-0">📷 ' + esc(id) + "</div>" +
              (rank === 0 ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 shrink-0">⭐ ' + T("busiestNow") + "</span>" : "") +
            "</div>" +
            '<div class="font-semibold">' + esc(z.last_count) + " " + T("people") + "</div>" +
            '<div class="text-xs opacity-60">' + T("footfallToday") + ": " + esc(z.footfall) + "</div>" +
            '<div class="zone-bar-track"><div class="zone-bar-fill" style="width:' + width + '%"></div></div>';
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

  /** Occupancy gauge: current people vs store capacity with congestion bands. */
  function renderCapacity(state) {
    const el = $("capacity-gauge");
    if (!el) return;
    const st = (state && state.current_status) || {};
    const count = st.count != null ? Number(st.count) : 0;
    const capacity = parseInt((cachedCfg && cachedCfg.store_capacity) || "50", 10) || 0;
    if (!capacity) {
      el.innerHTML = '<div class="text-xs opacity-60">' + T("capacityUnknown") + "</div>";
      return;
    }
    const ratio = Math.max(0, Math.min(1, count / capacity));
    const pct = Math.round(ratio * 100);
    const band = ratio >= 0.9 ? "red" : ratio >= 0.6 ? "amber" : "green";
    const headroom = Math.max(0, capacity - count);
    el.innerHTML =
      '<div class="flex items-center justify-between text-xs mb-1">' +
        '<span class="opacity-70">' + T("capacityTitle") + "</span>" +
        '<span class="font-semibold">' + count + " / " + capacity + "</span>" +
      "</div>" +
      '<div class="gauge-track"><div class="gauge-fill gauge-' + band + '" style="width:' + pct + '%"></div></div>' +
      '<div class="text-xs opacity-60 mt-1">' +
        (headroom > 0 ? tf("capacityHeadroom", { n: headroom }) : T("capacityFull")) +
      "</div>";
  }

  /** Next busy hour (rush forecast) from the 7-day staffing plan. */
  function renderRushForecast(state) {
    const el = $("rush-forecast");
    if (!el) return;
    const report = (state && state.last_analytics_report) || {};
    const plan = (report.staffing_plan || []).filter((p) => p.recommended_staff > 0);
    if (!plan.length) { el.innerHTML = ""; return; }
    const nowH = new Date().getHours();
    const next = plan.find((p) => p.hour === (nowH + 1) % 24) || plan.find((p) => p.hour === (nowH + 2) % 24);
    let html = '<div class="text-sm font-semibold mb-2">' + T("rushForecast") + "</div>";
    if (next) {
      const start = String(next.hour).padStart(2, "0") + ":00";
      const end = String((next.hour + 1) % 24).padStart(2, "0") + ":00";
      html +=
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<span class="text-xs opacity-70">' + T("nextRush") + "</span>" +
          '<span class="font-semibold">' + tf("rushWindow", { start, end }) + "</span>" +
          '<span class="text-xs opacity-70">' + tf("rushStaff", { n: next.recommended_staff }) + "</span>" +
          (next.hour === (nowH + 1) % 24 ? '<span class="badge badge-amber">' + T("getReady") + "</span>" : "") +
        "</div>";
    } else {
      html += '<div class="text-xs opacity-60">' + T("noRushAhead") + "</div>";
    }
    el.innerHTML = html;
  }

  /** Timeline of the most recent staffing gaps (time + camera + crowd). */
  function renderRecentGaps(state) {
    const el = $("recent-gaps");
    if (!el) return;
    const report = (state && state.last_analytics_report) || {};
    const gaps = report.last_staffing_gaps || [];
    let html = '<div class="text-sm font-semibold mb-1">' + T("recentGaps") + "</div>";
    if (!gaps.length) {
      html += '<div class="text-xs opacity-60">' + T("noGaps24h") + "</div>";
    } else {
      gaps.forEach((g) => {
        const time = g.timestamp
          ? new Date(g.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—";
        html +=
          '<div class="flex items-center gap-2 text-xs py-1.5" style="border-bottom:1px solid rgba(143,163,184,0.12)">' +
            '<span class="text-red-400 shrink-0">⚠</span>' +
            '<span class="opacity-70 shrink-0">' + esc(time) + "</span>" +
            '<span class="font-semibold truncate min-w-0">' + esc(g.camera_id || "?") + "</span>" +
            '<span class="opacity-70 ml-auto shrink-0">' + esc(g.count) + " " + T("people") + " · " + T("noStaffShort") + "</span>" +
          "</div>";
      });
    }
    el.innerHTML = html;
  }

  /** Prioritized "what should I do right now" action feed for the owner. */
  function renderActions(state) {
    const el = $("ops-feed");
    if (!el) return;
    const st = (state && state.current_status) || {};
    const report = (state && state.last_analytics_report) || {};
    const actions = [];

    // 1) Rush starting within the hour
    const plan = (report.staffing_plan || []).filter((p) => p.recommended_staff > 0);
    const nowH = new Date().getHours();
    const nextH = plan.find((p) => p.hour === (nowH + 1) % 24);
    if (nextH) actions.push(tf("actRush", { n: nextH.recommended_staff, h: String(nextH.hour).padStart(2, "0") + ":00" }));

    // 2) Congestion happening right now
    if (st.status === "Critical" || st.status === "Congested") {
      actions.push(tf("actCongested", { level: st.status }));
    }

    // 3) Staffing gaps over the last 24h
    if (report.staffing_gaps > 0) actions.push(tf("actGaps", { n: report.staffing_gaps }));

    // 4) Failing cameras
    const health = (state && state.device && state.device.cameras_health) || {};
    Object.keys(health).forEach((id) => {
      const h = health[id];
      if (h && h.fail > 0 && h.fail >= h.ok) actions.push(tf("actCamera", { cam: id }));
    });

    // 5) Subscription expiring within a week
    const exp = state && state.subscription_expiry;
    if (exp) {
      const days = Math.ceil((exp * 1000 - Date.now()) / 86400000);
      if (days <= 7) actions.push(days <= 0 ? T("actSubSoon") : tf("actSubDays", { d: days }));
    }

    // 6) Anomalous day vs typical weekday
    const base = report.today_vs_baseline || {};
    if (base.anomaly && base.weekday && base.pct_diff != null) {
      actions.push(tf(base.pct_diff >= 0 ? "actAnomalyUp" : "actAnomalyDown", { day: base.weekday }));
    }

    // 7) Quiet right now (slow-hour tip)
    const count = st.count != null ? Number(st.count) : null;
    if (count != null && count <= 1 && report.footfall_today > 0) actions.push(T("actSlow"));

    let html = '<div class="text-sm font-semibold mb-2">' + T("opsFeed") + "</div>";
    if (!actions.length) {
      html += '<div class="text-xs opacity-60">' + T("allGood") + "</div>";
    } else {
      actions.slice(0, 4).forEach((a) => {
        html += '<div class="ops-item">' + a + "</div>";
      });
    }
    el.innerHTML = html;
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
    // Today vs typical weekday
    const base = report.today_vs_baseline || {};
    const bc = $("baseline-card");
    if (bc && base.weekday && base.pct_diff != null) {
      const up = base.pct_diff >= 0;
      const color = Math.abs(base.pct_diff) >= 50 ? (up ? "text-red-400" : "text-amber-400") : (up ? "text-green-400" : "text-blue-300");
      bc.innerHTML =
        '<div class="text-xs opacity-60">' + T("todayVsTypical") + " " + esc(base.weekday) + "</div>" +
        '<div class="text-2xl font-bold ' + color + '">' + (up ? "+" : "") + esc(base.pct_diff) + "%</div>" +
        '<div class="text-xs opacity-60">' + T("todaySoFar") + ": " + esc(base.today_so_far) +
        " · " + T("typicalSoFar") + ": " + esc(base.baseline_so_far) + "</div>" +
        (base.anomaly ? '<div class="mt-1 badge badge-amber">' + T("anomalyDay") + "</div>" : "");
    } else if (bc) {
      bc.innerHTML = '<div class="text-xs opacity-60">' + T("todayVsTypical") + '</div><div class="text-sm opacity-50">' + T("insufficientData") + "</div>";
    }
    // Dwell estimate
    const dwell = report.dwell || {};
    const dc = $("dwell-card");
    if (dc) {
      dc.innerHTML =
        '<div class="text-xs opacity-60">' + T("dwellEstimate") + "</div>" +
        '<div class="text-2xl font-bold">' + (dwell.dwell_minutes != null ? esc(dwell.dwell_minutes) + " " + T("minutes") : "—") + "</div>" +
        '<div class="text-xs opacity-60">' + T("avgOccupancy") + ": " + esc(dwell.avg_occupancy != null ? dwell.avg_occupancy : "—") +
        " · " + T("arrivals") + ": " + esc(dwell.arrivals != null ? dwell.arrivals : "—") + "</div>";
    }
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
    row.className = "flex gap-2 items-center flex-wrap";
    row.setAttribute("data-cam-row", "");
    row.innerHTML =
      '<input class="cam-id input w-20 min-w-0" placeholder="id" value="' + esc(cam.id) + '">' +
      '<input class="cam-url input flex-1 min-w-[120px]" placeholder="rtsp://user:pass@ip:554/stream" value="' + esc(cam.url) + '">' +
      '<select class="cam-role input w-24 min-w-0">' +
      ["entrance", "cashier", "aisle", "general"].map((r) =>
        '<option value="' + r + '"' + (r === (cam.role || "general") ? " selected" : "") + ">" + r + "</option>").join("") +
      "</select>" +
      '<button class="btn btn-ghost" data-cam-remove>✕</button>';
    row.querySelector("[data-cam-remove]").addEventListener("click", () => row.remove());
    $("camera-list").appendChild(row);
  }

  async function loadSettingsForm() {
    const cfg = await TMA.config.get();
    ["bot_token", "state_channel_id", "admin_id", "store_capacity", "staffing_threshold", "refresh_seconds", "bridge_secret", "relay_bot_token"]
      .forEach((k) => { const el = $(k); if (el) el.value = cfg[k] || ""; });
    $("prompt-input").value = cfg.ai_target_prompt || "";
    $("camera-list").innerHTML = "";
    const cams = cfg.cctv_rtsp_urls && cfg.cctv_rtsp_urls.length ? cfg.cctv_rtsp_urls : [{ id: "cam1", url: "", role: "entrance" }];
    cams.forEach(addCameraRow);
    // Branches (multi-store)
    const bl = $("branch-list");
    bl.innerHTML = "";
    const branches = Array.isArray(cfg.branches) ? cfg.branches : [];
    branches.forEach((b) => addBranchRow(b));
    renderBranchSelect(cfg);
  }

  function addBranchRow(b) {
    b = b || { name: "", channel_id: "" };
    const row = document.createElement("div");
    row.className = "flex gap-2 items-center flex-wrap";
    row.setAttribute("data-branch-row", "");
    row.innerHTML =
      '<input class="branch-name input flex-1 min-w-[100px]" placeholder="' + T("branchName") + '" value="' + esc(b.name) + '">' +
      '<input class="branch-channel input flex-1 min-w-[100px]" placeholder="' + T("branchChannel") + '" value="' + esc(b.channel_id) + '">' +
      '<button class="btn btn-ghost shrink-0" data-branch-remove>✕</button>';
    row.querySelector("[data-branch-remove]").addEventListener("click", () => {
      row.remove();
      refreshCfgCache();
    });
    $("branch-list").appendChild(row);
  }

  function collectBranches() {
    return Array.from(document.querySelectorAll("[data-branch-row]")).map((row) => ({
      name: row.querySelector(".branch-name").value.trim(),
      channel_id: row.querySelector(".branch-channel").value.trim(),
    })).filter((b) => b.name && b.channel_id);
  }

  async function refreshCfgCache() {
    const cfg = await TMA.config.get();
    renderBranchSelect(cfg);
  }

  function renderBranchSelect(cfg) {
    const sel = $("branch-select");
    if (!sel) return;
    const branches = Array.isArray(cfg.branches) ? cfg.branches : [];
    sel.innerHTML = "";
    branches.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.name;
      opt.textContent = b.name;
      if (cfg.active_branch === b.name) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.classList.toggle("hidden", branches.length < 2);
  }

  async function onBranchChange() {
    const sel = $("branch-select");
    if (!sel) return;
    const cfg = await TMA.config.get();
    cfg.active_branch = sel.value || "";
    await TMA.config.set({ active_branch: cfg.active_branch });
    refresh();
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
      relay_bot_token: $("relay_bot_token").value.trim(),
      branches: collectBranches(),
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
      const viaLabel = via === "relay"
        ? "relay bot"
        : via === "api"
          ? "channel (main token — daemon may not see it)"
          : "sendData";
      toast("Saved — pushed via " + viaLabel);
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
    $("add-branch").addEventListener("click", () => addBranchRow());
    const bsel = $("branch-select");
    if (bsel) bsel.addEventListener("change", onBranchChange);
    TMA.config.get().then(renderBranchSelect);
    $("save-settings").addEventListener("click", saveSettings);
    if (TMA.isDemo) {
      const banner = $("demo-banner");
      if (banner) banner.classList.remove("hidden");
    }
    await refresh();
    scheduleRefresh();
  });
})();
