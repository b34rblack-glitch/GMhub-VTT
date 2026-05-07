# GMhub-VTT

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

## What it does (target)

- **Pull** the DMhub codex (NPCs, Locations, Factions, Items, Quests, Lore), long-form notes, and the active session plan into Foundry as JournalEntries.
- **Push** GM table-side work back to DMhub: visibility flips, new entries, edits, and quick-notes captured during play.
- **Manual** sync only. No live/background sync. The GM presses Pull or Push when they choose.
- **One world ↔ one campaign.** Set once in module settings.

## What it does NOT do

- Does not replace Foundry's native Scenes, Actors (D&D 5e sheets), combat tracker, or compendiums.
- Does not import maps, player characters, encounters, or AI features.
- Does not run sync in the background or mirror player-side actions.

The module talks to your web app over a small REST surface, all under `/api/v1`. Every request uses `Authorization: Bearer <key>` and JSON bodies. **This README is the authoritative source of the request/response shapes** — `dmhub-app` references this file via its `docs/SISTER_REPO.md`.

## Installation (manifest URL)

```
https://github.com/b34rblack-glitch/GMhub-VTT/releases/latest/download/module.json
```

> Compatibility: Foundry v12 (verified), D&D 5e system 3.0+. v13 readiness tracked in `SCOPE.md`.

## Configuration

In Foundry: **Game Settings → Configure Settings → Module Settings → GMhub VTT**

| Setting        | What it does                                                |
|----------------|-------------------------------------------------------------|
| DMhub Base URL | Root URL of the DMhub-app deployment                        |
| DMhub API Key  | Bearer token used in `Authorization: Bearer …` (GM-only)    |
| Campaign       | Bound DMhub campaign for this Foundry world                 |

Push and Pull live in the **GMhub** section of the Journal sidebar.

## API contract

The module talks to the DMhub Public API tracked under Epic E in [`b34rblack-glitch/dmhub-app`](https://github.com/b34rblack-glitch/dmhub-app). The endpoint surface is owned by that work — not duplicated in this README — to keep one source of truth. See [`SCOPE.md`](./SCOPE.md) for the content types involved.

## Development

Clone into your Foundry `Data/modules/` directory:

```bash
git clone https://github.com/b34rblack-glitch/GMhub-VTT.git gmhub-vtt
```

Then enable the module in your world.

## Cross-references

See [`docs/EPICS.md`](docs/EPICS.md) for the full backlog. High level:
- Actor sync (5e character sheets ↔ GMhub)
- Scene/map import
- Webhook-driven live updates instead of polling
- Foundry v13 compatibility
