# 📱 telegram-retail-ai-dashboard

**Serverless Telegram Mini App for the Retail AI appliance.**

A purely static dashboard (no backend, no build step, zero hosting cost) that
shows real-time store occupancy, retail BI charts, and lets owners change
camera/prompt settings — while an admin panel manages subscriptions. It is the
UI half of the system; the edge half is
[`poco-retail-ai-core`](https://github.com/m0502369637-hub/poco-retail-ai-core).

```
┌────────────── POCO F3 (edge core) ──────────────┐      ┌── THIS REPO ──────────┐
│  CCTV → MiniCPM-V → SQLite → KPIs               │      │  index.html (owner)   │
│   └─ sendMessage + pinChatMessage ──────┐       │      │  admin.html (admin)   │
└─────────────────────────────────────────┼───────┘      │  Telegram WebApp SDK  │
                                          ▼              │  Chart.js BI charts   │
                              PRIVATE TELEGRAM CHANNEL ◄─┼─ getChat(pinned state)│
                              (zero-cost state bus)      │  sendMessage(config)  │
                                          ▲              │  CloudStorage mirror  │
                              settings / subscriptions ──┘                       │
                                          └──────────────────────────────────────┘
```

> ⚠️ **Design deviation from the knowledge base.** The KB proposes Bot API
> methods `getCloudStorageValues` / `setCloudStorageValues`. Those **do not
> exist** in the Telegram Bot API (CloudStorage is client-side only, per user).
> This repo therefore uses the verified zero-cost equivalent: the dashboard
> reads the pinned state envelope the core posts to a **private channel** via
> `getChat` → `pinned_message.text`, and pushes settings/subscriptions as JSON
> envelopes with `sendMessage` (or `WebApp.sendData` as fallback). The KB's
> CloudStorage keys are still used as the dashboard's per-user mirror for
> instant reopen and offline display.

---

## 🚀 How to run it

### Option A — local development (30 seconds)

It's a static site — serve the folder with any HTTP server:

```bash
git clone https://github.com/m0502369637-hub/telegram-retail-ai-dashboard.git
cd telegram-retail-ai-dashboard
python3 -m http.server 8080          # or: npx serve .
# open http://localhost:8080
```

Outside Telegram the app runs in **demo mode** (mock data + banner), so the
whole UI — badges, charts, settings, admin — is testable in a normal browser.

### Option B — GitHub Pages (recommended for production)

1. Push this repo to GitHub (it's already wired for Pages via
   `.github/workflows/pages.yml`).
2. Repo **Settings → Pages** → *Source: GitHub Actions* (already enabled).
3. The first push deploys to
   `https://<user>.github.io/telegram-retail-ai-dashboard/`.

**Why Pages?** Telegram Mini Apps require an HTTPS URL, and Pages provides one
for free.

### Option C — any other static host

Netlify / Cloudflare Pages / Vercel all work — point them at the repo root
(no build command). Just use the resulting HTTPS URL in BotFather.

---

## 🔗 Wiring it to Telegram (step by step)

### 1. Create the bot

Chat with [@BotFather](https://t.me/BotFather):

```
/newbot           → name it "Retail AI"
/token            → copy the token (you'll paste it into the app Settings)
```

### 2. Create the state channel (the zero-cost bus)

1. In Telegram: **New Channel** → name it (e.g. `MyStoreRetailAI`) → **Private**.
2. Add your bot as **administrator** with **Post messages** and
   **Pin messages** rights.
3. Note the channel `@username` (create one in channel settings if missing).

### 3. Register the Mini App

BotFather → `/newapp` (or `/mybots` → Bot Settings → Menu Button):

- URL: `https://<user>.github.io/telegram-retail-ai-dashboard/`
- Set it as the bot's **Menu Button** so it opens inside Telegram.

### 4. First launch — configure the bridge

Open the app, go to **Settings → Telegram bridge** and enter:

| Field | Value |
|---|---|
| `BOT_TOKEN` | the token from step 1 |
| `STATE_CHANNEL_ID` | the channel `@username` from step 2 |
| `ADMIN_ID` | your numeric Telegram id (ask [@userinfobot](https://t.me/userinfobot)) |

Tap **Save & push to core** — the app now reads the pinned state the edge
device posts and can push settings back to it.

---

## 🧭 Pages

| Page | Who | What |
|---|---|---|
| `index.html` | Store owner | Live occupancy badge (Normal/Congested/Critical/Blocked), congestion index, alert banner, subscription line, BI charts (peak hours, footfall trend, efficiency, staffing gaps), camera + prompt settings |
| `admin.html` | Admin (`ADMIN_ID`) | Fleet monitor (device status, last seen, expiry), user list, subscription grants (+30/+90/+365 days) pushed to the core |

## 🔑 Data model

| Where | Key | Meaning |
|---|---|---|
| Channel (pinned envelope) | `type: "state"` | `current_status` + `last_analytics_report` + `subscription_expiry`, produced by the core |
| Channel (envelope) | `set_config` / `set_subscription` | settings/subscription changes, consumed by the core via `getUpdates` |
| CloudStorage (mirror) | `current_status`, `last_analytics_report`, `subscription_expiry`, `cctv_rtsp_urls`, `ai_target_prompt` | KB keys mirrored client-side for instant reopen / offline |
| CloudStorage | `retail_ai_config`, `retail_ai_users` | app config + admin user list |

## 🔐 Security notes

- The bot token is entered **at runtime** and stored in the user's own
  CloudStorage — it is **never** in this repo.
- Embedding the token client-side is a deliberate trade-off of the zero-cost
  design (the KB's proposed bot-side CloudStorage API doesn't exist).
  Mitigations: dedicated bot, private channel, token rotation via
  BotFather `/revoke`.
- The admin page gates on `ADMIN_ID`; the core additionally validates the
  `set_subscription` envelope's `user_id` against its own `ADMIN_ID`.

## 🧯 Troubleshooting

| Symptom | Fix |
|---|---|
| "No analytics yet" forever | Start the edge daemon (`poco-retail-ai-core`); verify the pinned post exists in the channel |
| `CloudStorage` errors outside Telegram | Expected — CloudStorage needs a Telegram client; the app falls back to localStorage demo mode |
| `sendData failed` | `sendData` only works when launched from a bot chat; configure BOT_TOKEN + channel instead |
| Empty state in live mode | Check the channel is **private** but the bot is admin; check `pinned_message` exists (grant Pin rights) |
| Charts not rendering | Chart.js CDN blocked — serve the lib locally (see `assets/js/`) |

## 📁 Repository layout

```
telegram-retail-ai-dashboard/
├── index.html                  # store owner dashboard
├── admin.html                  # admin panel (subscriptions + fleet)
├── assets/
│   ├── js/telegram-sdk.js      # TMA wrapper + channel-bus Bot API client
│   ├── js/app.js               # owner dashboard logic
│   ├── js/charts.js            # Chart.js builders (theme-aware)
│   ├── js/admin.js             # admin logic
│   └── css/style.css           # mobile-first, safe-area aware styles
├── .github/workflows/pages.yml # auto-deploy to GitHub Pages
└── docs/ARCHITECTURE.md        # component map + data flow
```

## 📄 License

MIT — see [LICENSE](LICENSE).
