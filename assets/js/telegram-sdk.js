/**
 * Retail AI Dashboard — Telegram Mini App SDK wrapper + zero-cost bridge.
 *
 * Two layers:
 *  1. TMA      : WebApp init, theming, CloudStorage (client-side only) with a
 *                localStorage-backed demo fallback.
 *  2. BotApi   : the channel-bus client. Reads the pinned state envelope the
 *                edge core posts (getChat -> pinned_message.text) and posts
 *                set_config / set_subscription envelopes (sendMessage).
 *                WebApp.sendData() is used as a fallback when no token/channel
 *                is configured (only works when launched from a bot chat).
 *
 * Envelope schema is shared with poco-retail-ai-core (see its README).
 *
 * IMPORTANT (documented deviation from the project knowledge base): the Bot
 * API methods getCloudStorageValues/setCloudStorageValues DO NOT EXIST, so the
 * dashboard mirrors the channel state into its own CloudStorage under the KB
 * keys for instant reopen + offline display.
 */
(function () {
  "use strict";

  const CONFIG_KEY = "retail_ai_config";
  const MIRROR_KEYS = ["current_status", "last_analytics_report", "subscription_expiry"];

  const WebApp = (window.Telegram && window.Telegram.WebApp) || null;
  const isDemo = !WebApp;

  /** localStorage-backed stand-in for Telegram CloudStorage (demo mode). */
  const demoStore = {
    async getItem(key) {
      try { return localStorage.getItem("dsh_demo_" + key); } catch { return null; }
    },
    async setItem(key, value) {
      try { localStorage.setItem("dsh_demo_" + key, String(value)); } catch {}
    },
    async getItems(keys) {
      const out = {};
      for (const k of keys) out[k] = await this.getItem(k);
      return out;
    },
    async setItems(kv) {
      for (const [k, v] of Object.entries(kv)) await this.setItem(k, v);
    },
  };

  function storage() {
    if (!WebApp) return demoStore;
    if (WebApp.CloudStorage && WebApp.CloudStorage.getItems) {
      return {
        getItem: (k) => new Promise((res) => WebApp.CloudStorage.getItem(k, (e, v) => res(e || !v ? null : v))),
        setItem: (k, v) => new Promise((res) => WebApp.CloudStorage.setItem(k, v, (e) => res(!e))),
        getItems: (keys) => new Promise((res) => WebApp.CloudStorage.getItems(keys, (e, v) => res(e || !v ? {} : v))),
        setItems: (kv) => new Promise((res) => WebApp.CloudStorage.setItems(kv, (e) => res(!e))),
      };
    }
    return demoStore;
  }

  const store = storage();

  /** Read/write the app config (token, channel, admin id, thresholds). */
  const configApi = {
    defaults: {
      bot_token: "",
      state_channel_id: "",
      admin_id: "",
      user_id: "",
      store_capacity: "50",
      staffing_threshold: "15",
      refresh_seconds: "30",
    },
    async get() {
      try {
        const raw = await store.getItem(CONFIG_KEY);
        return Object.assign({}, this.defaults, raw ? JSON.parse(raw) : {});
      } catch { return Object.assign({}, this.defaults); }
    },
    async set(patch) {
      const merged = Object.assign({}, await this.get(), patch);
      await store.setItem(CONFIG_KEY, JSON.stringify(merged));
      return merged;
    },
  };

  /** Thin client for the Telegram Bot API (CORS-enabled by Telegram). */
  const botApi = {
    base(token) { return "https://api.telegram.org/bot" + token; },
    async getPinnedState(token, channelId) {
      const url = this.base(token) + "/getChat?chat_id=" + encodeURIComponent(channelId);
      const resp = await fetch(url);
      const body = await resp.json();
      if (!body.ok || !body.result) throw new Error(body.description || "getChat failed");
      const pinned = body.result.pinned_message;
      if (!pinned || !pinned.text) return null;
      return JSON.parse(pinned.text);
    },
    async postEnvelope(token, channelId, envelope) {
      const url = this.base(token) + "/sendMessage";
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channelId,
          text: JSON.stringify(envelope),
          disable_notification: true,
        }),
      });
      const body = await resp.json();
      if (!body.ok) throw new Error(body.description || "sendMessage failed");
      return body.result;
    },
  };

  /** Build a set_config / set_subscription envelope with the current user id. */
  function currentUserId() {
    if (WebApp && WebApp.initDataUnsafe && WebApp.initDataUnsafe.user) {
      return String(WebApp.initDataUnsafe.user.id);
    }
    return "0"; // demo mode
  }

  function buildEnvelope(type, payload) {
    return { type, user_id: currentUserId(), payload };
  }

  /** Post an envelope via Bot API; falls back to sendData when unconfigured. */
  async function pushEnvelope(type, payload) {
    const cfg = await configApi.get();
    if (cfg.bot_token && cfg.state_channel_id) {
      const envelope = buildEnvelope(type, payload);
      await botApi.postEnvelope(cfg.bot_token, cfg.state_channel_id, envelope);
      return "api";
    }
    if (WebApp && WebApp.sendData) {
      WebApp.sendData(JSON.stringify(buildEnvelope(type, payload)));
      return "sendData";
    }
    throw new Error("No Telegram bridge configured. Fill in BOT_TOKEN + channel in Settings.");
  }

  /** Mirror the state envelope into CloudStorage under the KB keys. */
  async function mirrorState(stateEnvelope) {
    if (!stateEnvelope || stateEnvelope.type !== "state") return;
    const mirror = {};
    if (stateEnvelope.current_status) mirror["current_status"] = JSON.stringify(stateEnvelope.current_status);
    if (stateEnvelope.last_analytics_report) mirror["last_analytics_report"] = JSON.stringify(stateEnvelope.last_analytics_report);
    if (stateEnvelope.subscription_expiry != null) mirror["subscription_expiry"] = String(stateEnvelope.subscription_expiry);
    if (Object.keys(mirror).length) {
      try { await store.setItems(mirror); } catch { /* mirroring is best-effort */ }
    }
  }

  /** Demo-mode synthetic state so the UI is fully testable in a browser. */
  function demoTick() {
    const hours = [];
    for (let h = 8; h <= 21; h++) {
      hours.push({ hour: Math.floor(Date.now() / 1000) - (Date.now() % 3600000) / 1000 - (21 - h) * 3600, footfall: 2 + Math.round(14 * Math.exp(-Math.pow(h - 13, 2) / 18) + Math.random() * 5) });
    }
    const count = 8 + Math.floor(Math.random() * 18);
    const capacity = 50;
    const idx = count / capacity;
    return {
      type: "state",
      updated_at: Math.floor(Date.now() / 1000),
      subscription_expiry: Math.floor(Date.now() / 1000) + 30 * 86400,
      current_status: {
        status: idx >= 0.9 ? "Critical" : idx >= 0.6 ? "Congested" : "Normal",
        count,
        alert: count > 15 && Math.random() < 0.3 ? "Staffing gap: no staff detected in a busy area" : null,
        camera_id: "cam1",
        congestion_index: Math.round(idx * 100) / 100,
        timestamp: Math.floor(Date.now() / 1000),
      },
      last_analytics_report: {
        generated_at: Math.floor(Date.now() / 1000),
        peak_hour: "13:00",
        peak_hour_distribution: hours,
        total_visits: hours.reduce((a, h) => a + h.footfall, 0),
        footfall_today: 142,
        footfall_yesterday: 118,
        trend_pct_vs_yesterday: 20.3,
        staffing_gaps: 2,
        congestion_index: Math.round(idx * 100) / 100,
        congestion_level: idx >= 0.9 ? "Critical" : idx >= 0.6 ? "Congested" : "Normal",
        efficiency: "92.5%",
        current_count: count,
      },
    };
  }

  function haptic(type) {
    if (WebApp && WebApp.HapticFeedback) {
      WebApp.HapticFeedback.notificationOccurred(type || "success");
    }
  }

  const tma = {
    isDemo,
    WebApp,
    store,
    config: configApi,
    botApi,
    mirrorState,
    pushEnvelope,
    demoTick,
    haptic,
    currentUserId,
    MIRROR_KEYS,
    init() {
      if (!WebApp) return;
      WebApp.ready();
      WebApp.expand();
      if (WebApp.setHeaderColor) WebApp.setHeaderColor(WebApp.themeParams.bg_color || "#1c2733");
      if (WebApp.enableClosingConfirmation) WebApp.enableClosingConfirmation();
    },
  };

  window.RetailTMA = tma;
})();
