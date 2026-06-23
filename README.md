# SF Event Log Analyzer — Chrome Extension

A Chrome extension that connects directly to your authenticated Salesforce org, lists available Event Log Files, and runs full analysis in a new browser tab — no downloading required.

---

## Key Features

- **Live log list** — fetches EventLogFile records directly from the Salesforce REST API using your existing browser session
- **One-click analysis** — select a log from the list and the analysis opens instantly
- **Multiple event types** — Apex exceptions, REST API calls, Aura requests, login patterns, API usage, and any other event type with a generic fallback
- **Overview, Table, and Charts tabs** — stat cards, top-N breakdowns, timeline and bar charts
- **Quick filters** — errors only, slow requests (>1s), external IPs, high CPU (>500ms)
- **Global search** — filter across all columns instantly
- **Auto org detection** — detects which Salesforce org you're on and connects automatically
- **No download needed** — log CSV is fetched and analysed in memory

---

## How authentication works

The extension reads the **`sid` session cookie** that Chrome already holds when you are logged into a Salesforce org. It does not store credentials, does not contact any external server, and does not require a connected app or OAuth client ID.

All API calls go directly from your browser to your org — the same network path as any other tab you have open. The background service worker proxies those calls so the session cookie is included automatically.

This is the same approach used by [Salesforce Inspector Reloaded](https://github.com/tprouvot/Salesforce-Inspector-reloaded) and similar developer tools. A connected app (OAuth 2.0 with a client ID) is the right pattern for a *server* that needs long-lived access to an org. For a browser extension operating inside an already-authenticated session, reading the existing cookie is the cleaner and more appropriate solution — no external infrastructure, and no permissions beyond what the logged-in user already has.

**Manifest permissions explained:**

| Permission | Why it is needed |
|---|---|
| `cookies` | Read the `sid` session cookie to authenticate API calls |
| `tabs` | Detect which Salesforce org the active tab is pointed at |
| `storage` | Remember the org URL between tab opens (session storage only) |
| `activeTab` | Trigger org detection when you click the toolbar icon |
| `host_permissions` (`*.salesforce.com` etc.) | Allow the service worker to make fetch requests to your org's API |

---

## Requirements

| Item | Detail |
|---|---|
| Chrome | 114+ (Manifest V3 + storage.session API) |
| Salesforce | Any org you're logged into in the browser |
| Permission | Read access to EventLogFile (typically System Administrator or a custom profile with the permission) |

No Salesforce CLI, no build tools, no installation of other extensions required.

---

## Installation

This extension is not on the Chrome Web Store — it is installed directly from source. This is standard practice for internal developer tools and is called *sideloading*.

1. Download and unzip the [latest release](https://github.com/nwmorph/sf-event-log-analyzer-extension/releases/latest), **or** clone the repo:
   ```bash
   git clone https://github.com/nwmorph/sf-event-log-analyzer-extension.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `sf-event-log-analyzer-extension` folder
5. The icon appears in your Chrome toolbar

> Chrome may show a one-time banner saying *"You have extensions running in developer mode"* — this is expected for sideloaded extensions and is not a security concern for a tool you have installed yourself from source.

To update, pull the latest changes (or replace the folder) and click **↺** on the extension card in `chrome://extensions`.

---

## Usage

1. Log into a Salesforce org in any Chrome tab
2. Click the **SF Event Log Analyzer** icon in the toolbar → a new tab opens
3. Set the date range and optionally filter by event type
4. Click **↺ Refresh** — the file list loads from your current org
5. Click any file row → the analysis renders on the right

---

## Supported Event Types

| Event Type | Specialised Overview |
|---|---|
| ApexUnexpectedException | Exception types, affected classes, affected users |
| RestApi | Error rate, response times, top endpoints, client IPs |
| AuraRequest | Status codes, response times, connected apps |
| Login | Failed logins, unique users, source IPs |
| ApiTotalUsage | API type breakdown, top users |
| Any other type | Generic top-N column breakdown |

---

## Project Structure

```
manifest.json      # Chrome extension manifest (MV3)
background.js      # Service worker — API proxy, session handling
content.js         # Injected into Salesforce pages — org URL detection
newtab/
├── index.html     # Full-page analyzer UI
├── app.js         # Log list, org connection, Chrome API glue
├── main.js        # Analysis and rendering engine
└── styles.css     # Styles with light/dark mode support
icons/             # Extension icons
```

---

## Credits

Created by **Niklas Waller**; source code written with [Claude](https://claude.ai) (Anthropic) acting as a coding agent under Niklas's direction.

**License:** MIT
