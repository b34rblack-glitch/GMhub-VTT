# GMhub-VTT

> The Foundry VTT module that brings [GMhub](https://www.gmhub.app/) into the live game session.

A Foundry VTT module that two-way-syncs GMhub campaign content with Foundry — no scenes, actors, or background sync. Built for Foundry v11–v14 (any system).

**GM hub account required**
---

## Vision

GMhub's value lands at the table. This module extends that reach into the place a lot of GMs already run their game — Foundry — so journal-shaped content (session notes, NPC writeups, location lore, agenda) doesn't have to live in two places. One source of truth for campaign cannon with many ways to use it. 



## Status

| | |
|---|---|
| Module version | `0.4.4` |
| Foundry compatibility | v11–v14 (verified v14) |
| System | dnd5e ≥3.0 |

---

## What it does (target)


- **Pull** the GMhub codex (NPCs, Locations, Factions, Items, Quests, Lore), long-form notes, and **a windowed slice of the session calendar** — all prep sessions + the most-recent recap + the running session if any — into Foundry as JournalEntries. Older recaps stay on the web app.
- **Push** GM table-side work back to GMhub: visibility flips, new entries, edits, quick-notes captured during play, and plan edits routed to whichever session journal carries the dirty page.
- **Manual** sync only. No live/background sync. The GM presses Pull or Push when they choose.
- **One world ↔ one campaign.** Set once in module settings.

## What it does NOT do

- Does not replace Foundry's native Scenes, Actors (D&D 5e sheets), combat tracker, or compendiums.
- Does not import maps, player characters, encounters, or AI features.

---

## Installation (manifest URL)

```
https://github.com/b34rblack-glitch/GMhub-VTT/releases/latest/download/module.json
```

> Compatibility: Foundry v14 (verified).

## Configuration

In Foundry: **Game Settings → Configure Settings → Module Settings → GMhub VTT**

| Setting        | What it does                                                |
|----------------|-------------------------------------------------------------|
| GMhub Base URL | Root URL of the GMhub-app deployment                        |
| GMhub API Key  | Bearer token used in `Authorization: Bearer …` (GM-only)    |
| Campaign       | Bound GMhub campaign for this Foundry world                 |
| Auto-push      | Optional. When on, every page edit (text, name, eye toggle) is pushed to GMhub immediately. Default off to honour the manual-sync contract. |

**Sync surface:** the **GMhub Sync** button in the Journal sidebar opens the dialog with Pull / Push / Test connection / Pick session / lifecycle controls. Pull populates a `GMhub Sessions` folder with one journal per windowed session; right-click any session journal → **Set as active session** to flip the lifecycle pointer. The session journal's **Pinned** page renders each pinned entity as a card with a clickable link into Foundry's full entity page.

## API contract

The module talks to the GMhub Public API.

