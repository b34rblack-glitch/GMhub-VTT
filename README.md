# GMhub VTT Bridge

> The Foundry VTT module that brings GMhub into the live game session.

A Foundry VTT module that two-way-syncs **Journal Entries** between Foundry and the [GMhub / DMhub web app](https://github.com/b34rblack-glitch/DMhub-app). Built for Foundry v11/v12, D&D 5e system.

---

## Vision

DMhub's value lands at the table. This module extends that reach into the place a lot of GMs already run their game — Foundry — so journal-shaped content (session notes, NPC writeups, location lore) doesn't have to live in two places.

The wedge is intentionally narrow: **journals first, with stable IDs that survive re-syncs.** Actor sheets, scenes, and live websocket updates are roadmap, not scope-creep into this version.

For the parent product's vision and shipped-feature log, see the [`dmhub-app` README](https://github.com/b34rblack-glitch/DMhub-app#readme) and its [`docs/EPICS.md`](https://github.com/b34rblack-glitch/DMhub-app/blob/main/docs/EPICS.md).

---

## Sister project

| Repo | Role |
|---|---|
| [**`dmhub-app`**](https://github.com/b34rblack-glitch/DMhub-app) | The web application this module syncs with. Hosts the `/api/v1` REST surface and issues the bearer tokens used for auth. Tracks this repo as **Epic G**. |
| **`gmhub-vtt`** *(this repo)* | The Foundry module. |

For the cross-repo contract see [`docs/SISTER_REPO.md`](docs/SISTER_REPO.md).

---

## Status

| | |
|---|---|
| Module version | `0.1.0` |
| Foundry compatibility | v11–v12 (verified v12) |
| System | dnd5e ≥3.0 |
| Shipped feature log | [`docs/EPICS.md`](docs/EPICS.md) |
| Upstream dependency | `dmhub-app` Epic E — Public API & Foundry Foundations |

> **Heads up:** the upstream API surface (Epic E in `dmhub-app`) is **planned, not yet shipped.** Until it ships, this module's REST contract is aspirational and end-to-end testing requires a stub server.

---

## Features

- One-click **push** of Foundry journals (with all pages) to GMhub
- One-click **pull** of GMhub journals into Foundry, creating or updating in place
- Optional **auto-push** when a journal is edited
- Per-journal context-menu action ("Push to GMhub")
- Stable external IDs stored in journal flags so re-syncing updates instead of duplicating

## Installation (manifest URL)

```
https://github.com/b34rblack-glitch/GMhub-VTT/releases/latest/download/module.json
```

## Configuration

In Foundry: **Game Settings → Configure Settings → Module Settings → GMhub VTT Bridge**

| Setting | What it does |
| --- | --- |
| GMhub Base URL | Root URL of your DMhub-app deployment |
| GMhub API Key | Bearer token used in `Authorization: Bearer …` |
| Auto-push journal updates | Push every edit to GMhub immediately |

The sync dialog is opened from the **GMhub Sync** button in the Journal sidebar.

## REST API contract (what DMhub-app needs to expose)

The module talks to your web app over a small REST surface, all under `/api/v1`. Every request uses `Authorization: Bearer <key>` and JSON bodies. **This README is the authoritative source of the request/response shapes** — `dmhub-app` references this file via its `docs/SISTER_REPO.md`.

### `GET /api/v1/ping`
Health check. Return `200 { "ok": true }`.

### `GET /api/v1/journals`
List journals. Optional query `?updatedSince=<ISO-8601>` for incremental pulls.

Response:
```json
{
  "journals": [
    { "id": "abc123", "name": "Session 1", "updatedAt": "2026-05-01T12:00:00Z" }
  ]
}
```
A bare array is also accepted. If list items already include `pages`, the module will skip the per-journal GET.

### `GET /api/v1/journals/:id`
Return one full journal:
```json
{
  "id": "abc123",
  "name": "Session 1",
  "folder": "Lore",
  "updatedAt": "2026-05-01T12:00:00Z",
  "pages": [
    {
      "id": "page-uuid-1",
      "foundryId": "JE-page-id",
      "name": "Intro",
      "type": "text",
      "sort": 0,
      "text": { "content": "<p>Hello</p>", "format": 1 }
    },
    {
      "id": "page-uuid-2",
      "name": "Map",
      "type": "image",
      "sort": 1,
      "src": "https://…/map.jpg",
      "image": { "caption": "Town square" }
    }
  ]
}
```

### `POST /api/v1/journals`
Create a journal. Request body matches the GET shape; `id` and page `id`s are `null` on first push. **Response must echo the saved journal with all `id`s assigned** — the module writes those IDs back into Foundry flags so the next push updates instead of creating.

### `PUT /api/v1/journals/:id`
Update an existing journal. The full payload is sent each time; reconcile pages by their `id`. Pages missing from the payload should be deleted. Same response shape as POST.

### `DELETE /api/v1/journals/:id`
Optional. The module doesn't call it today but reserves the verb.

### Page model notes
- `type` is `"text"` or `"image"` (matches Foundry's `JournalEntryPage` types).
- `text.format` is Foundry's `JOURNAL_ENTRY_PAGE_FORMATS` enum: `1 = HTML`, `2 = Markdown`. Treat unknown values as HTML.
- `foundryId` is informational — useful if you display the source in the GMhub UI, but the canonical key is your `id`.

## Authentication

The module sends one header:
```
Authorization: Bearer <user-supplied key>
```
Issue per-GM API keys from the DMhub-app and let users paste them into module settings. Keys are stored in world-scoped settings (GM-only).

## Development

Clone into your Foundry `Data/modules/` directory:
```bash
git clone https://github.com/b34rblack-glitch/GMhub-VTT.git gmhub-vtt
```
Then enable the module in your world.

## Roadmap

See [`docs/EPICS.md`](docs/EPICS.md) for the full backlog. High level:
- Actor sync (5e character sheets ↔ GMhub)
- Scene/map import
- Webhook-driven live updates instead of polling
- Foundry v13 compatibility
