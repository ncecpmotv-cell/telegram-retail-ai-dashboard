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
 * WRITE PATHS (in order):
 *  1. WebApp.sendData() — primary. Works with ONE bot: the Mini App's bot
 *     receives a web_app_data update and the edge daemon polls it via
 *     getUpdates. No token needed in the frontend for writes.
 *  2. Bot API post to the channel — fallback for link-launched apps. The
 *     token used HERE must be a RELAY bot's (a second bot admin of the
 *     channel): Telegram never delivers a bot's own channel posts back to
 *     itself, so using the main token would make the daemon blind to the
 *     write path.
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
      bridge_secret: "",
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

  /** Deterministic JSON matching the core's canonical_json (sorted keys). */
  function sortedStringify(obj) {
    if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return "[" + obj.map(sortedStringify).join(",") + "]";
    return "{" + Object.keys(obj).sort()
      .map((k) => JSON.stringify(k) + ":" + sortedStringify(obj[k]))
      .join(",") + "}";
  }

  async function hmacHex(secret, data) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** HMAC-sign an envelope with the shared BRIDGE_SECRET (when configured). */
  async function signEnvelope(type, payload, secret, userId) {
    const envelope = { type: type, payload: payload };
    if (userId) envelope.user_id = String(userId);
    if (secret && window.crypto && crypto.subtle) {
      envelope.sig = await hmacHex(secret, sortedStringify(envelope));
    }
    return envelope;
  }

  /** Verify a received envelope's signature (optional; only when secret set). */
  async function verifyEnvelope(envelope, secret) {
    if (!secret) return true;
    if (!(window.crypto && crypto.subtle) || typeof envelope.sig !== "string") return false;
    const rest = Object.assign({}, envelope);
    delete rest.sig;
    const expected = await hmacHex(secret, sortedStringify(rest));
    return expected === envelope.sig;
  }

  /** Thin client for the Telegram Bot API (CORS-enabled by Telegram). */
  const botApi = {
    base(token) { return "https://api.telegram.org/bot" + token; },
    async getPinnedState(token, channelId, secret) {
      const url = this.base(token) + "/getChat?chat_id=" + encodeURIComponent(channelId);
      const resp = await fetch(url);
      const body = await resp.json();
      if (!body.ok || !body.result) throw new Error(body.description || "getChat failed");
      const pinned = body.result.pinned_message;
      if (!pinned || !pinned.text) return null;
      const state = JSON.parse(pinned.text);
      if (!(await verifyEnvelope(state, secret))) {
        throw new Error("state signature invalid — check BRIDGE_SECRET");
      }
      return state;
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

  /** Post an envelope to the core.
   *
   * Primary path (live Telegram): WebApp.sendData() → the bot receives a
   * web_app_data update → the edge daemon picks it up via getUpdates. This
   * works with ONE bot and needs no token in the frontend.
   *
   * Fallback path: if sendData is unavailable (e.g. app opened from a plain
   * link instead of the bot chat) and a token+channel are configured, post
   * the envelope to the channel via the Bot API. NOTE: that token must be a
   * RELAY bot's (a second bot admin of the channel) — Telegram never echoes
   * a bot's own channel posts back to itself, so using the main token here
   * would make the daemon blind to the write path.
   */
  async function pushEnvelope(type, payload) {
    const cfg = await configApi.get();
    if (WebApp && WebApp.sendData) {
      const env = await signEnvelope(type, payload, cfg.bridge_secret, currentUserId());
      WebApp.sendData(JSON.stringify(env));
      return "sendData";
    }
    if (cfg.bot_token && cfg.state_channel_id) {
      const env = await signEnvelope(type, payload, cfg.bridge_secret, currentUserId());
      await botApi.postEnvelope(cfg.bot_token, cfg.state_channel_id, env);
      return "api";
    }
    throw new Error("No write path available: open the app from the bot chat (sendData) or configure a relay token + channel in Settings.");
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
    signEnvelope,
    verifyEnvelope,
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
