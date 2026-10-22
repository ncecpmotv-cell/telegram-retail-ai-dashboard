# 🏛️ Architecture — telegram-retail-ai-dashboard

## 1. Component map

| Component | File | Responsibility |
|---|---|---|
| TMA wrapper | `assets/js/telegram-sdk.js` | WebApp init/theme/haptics, CloudStorage (+demo fallback), Bot API client (`getChat` pinned read, `sendMessage` envelopes), `sendData` fallback, config store, demo state generator, CloudStorage mirroring |
| Charts | `assets/js/charts.js` | Null-safe, theme-aware Chart.js builders (peak-hour bar, footfall trend) |
| Owner UI | `index.html` + `assets/js/app.js` | Status badges, alert, subscription line, BI cards + charts, camera/prompt settings, bridge config, 30s polling |
| Admin UI | `admin.html` + `assets/js/admin.js` | ADMIN_ID gate, fleet monitor, user list, subscription push |
| Styles | `assets/css/style.css` | Telegram theme variables, safe-area insets, badges, skeleton, toast |
| Deploy | `.github/workflows/pages.yml` | node --check + GitHub Pages deploy on every push to main |

## 2. Data flow

```
                        ┌──────────────────────────────────────────┐
                        │            private state channel         │
                        │                                          │
  edge core ──sendMessage+pin──► {type:"state", current_status,    │
  (poco-retail-   │               last_analytics_report,           │
   ai-core)      │               subscription_expiry}              │
                 └── getUpdates ◄── channel_post                   │
                                      ▲                            │
                                      │ sendMessage (set_config /  │
                                      │           set_subscription)│
                                      │                            │
                          ┌───────────┴───────────────┐            │
                          │        dashboard         │            │
                          │  getChat → pinned_message │────────────┘
                          │  poll every 30s          │
                          │  CloudStorage mirror     │
                          │  (KB keys, per-user)     │
                          └──────────────────────────┘
```

1. **Read path** — the app fetches
   `https://api.telegram.org/bot<token>/getChat?chat_id=<channel>` (CORS-enabled
   by Telegram) and parses `result.pinned_message.text` as JSON. When the
   pinned message is absent/malformed the UI degrades gracefully to the last
   CloudStorage mirror.
2. **Write path** — settings/subscriptions are posted as envelopes to the same
   channel via `sendMessage`; the core's `getUpdates` stream receives them as
   `channel_post`. If no token/channel is configured, `WebApp.sendData()` is
   used (works only when the Mini App was launched from a chat with the bot —
   the UI reports the failure and tells the user to configure the bridge).
3. **Mirror** — every fetched state is mirrored into the user's CloudStorage
   under the KB keys (`current_status`, `last_analytics_report`,
   `subscription_expiry`), so reopening the app shows data instantly and the
   KB's CloudStorage key table remains meaningful.

## 3. Design deviation (CloudStorage)

The knowledge base specifies Bot API endpoints `getCloudStorageValues` /
`setCloudStorageValues` for the core↔cloud link. Verified against the official
Bot API (2026-08): **these methods do not exist**; Mini App CloudStorage is
client-side only and scoped per (bot, user). Consequences:

- The edge daemon cannot touch CloudStorage → the pinned-channel envelope is
  the real zero-cost bus (see the core repo's `docs/ARCHITECTURE.md`).
- CloudStorage remains in the design, exactly as the KB intends, for
  dashboard-local persistence and offline reopen.
- `sendData`/`web_app_data` is retained as the KB-style Mini-App→bot channel,
  used as a fallback write path.

## 4. Failure & demo behavior

- No Telegram WebApp → **demo mode**: mock state ticks, localStorage storage,
  banner shown; every panel and chart still works.
- Live but unconfigured → reads only the CloudStorage mirror; shows guidance
  to configure the bridge.
- Bot API errors → user-visible toast; polling continues.
- Admin without `ADMIN_ID` match → full-page lockout message.

## 5. Extension points

- New charts: add a builder to `charts.js` and a canvas in `index.html`.
- New KB keys: extend `TMA.MIRROR_KEYS` and the mirror logic.
- Multi-store: each store gets its own channel; the Settings bridge config
  switches between them.
- Future backend: replace `botApi` fetches with API calls — the UI layer is
  already isolated behind `RetailTMA`.
