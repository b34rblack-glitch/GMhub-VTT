# GMhub-VTT

A Foundry VTT module that lets a GM run a live tabletop session inside Foundry while DMhub stays the canonical archive of campaign content. **Foundry replaces the DMhub webapp's "Live Session" mode at the table; the webapp keeps prep and recap.**

> **Status:** early — module is in active scoping. The full intent baseline lives in [`SCOPE.md`](./SCOPE.md).

## What it does (target)

- **Pull** the DMhub codex (NPCs, Locations, Factions, Items, Quests, Lore), long-form notes, and the active session plan into Foundry as JournalEntries.
- **Push** GM table-side work back to DMhub: visibility flips, new entries, edits, and quick-notes captured during play.
- **Manual** sync only. No live/background sync. The GM presses Pull or Push when they choose.
- **One world ↔ one campaign.** Set once in module settings.

## What it does NOT do

- Does not replace Foundry's native Scenes, Actors (D&D 5e sheets), combat tracker, or compendiums.
- Does not import maps, player characters, encounters, or AI features.
- Does not run sync in the background or mirror player-side actions.

See [`SCOPE.md`](./SCOPE.md) for the full out-of-scope list and rationale.

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

- [`SCOPE.md`](./SCOPE.md) — canonical project scope and behaviour contract
- [DMhub-app](https://github.com/b34rblack-glitch/dmhub-app) — webapp this module integrates with; see `docs/integrations/gmhub-vtt-module.md` there
