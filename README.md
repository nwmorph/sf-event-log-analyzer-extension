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

## Requirements

| Item | Detail |
|---|---|
| Chrome | 114+ (Manifest V3 + storage.session API) |
| Salesforce | Any org you're logged into in the browser |
| Permission | Read access to EventLogFile (typically System Administrator or a custom profile with the permission) |

No Salesforce CLI, no build tools, no installation of other extensions required.

---

## Installation

1. Download the extension folder or clone the repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `sf-event-log-analyzer-extension` folder
5. The icon appears in your Chrome toolbar

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
