# GMhub-VTT — Project Scope

**Status:** Draft baseline — 2026-05-07
**Canonical home:** `b34rblack-glitch/GMhub-VTT/SCOPE.md`

This document captures the agreed intent for the GMhub-VTT Foundry module. Every change to scope (additions, removals, behaviour changes) lands here first. Implementation work, the README, and the GMhub-side public API surface should reference this document.

---

## Mission

GMhub-VTT is a Foundry VTT module that lets a GM run a live tabletop session inside Foundry while keeping their GMhub campaign as the canonical archive of campaign content. The module **replaces the webapp's "Live Session" mode at the table** — Foundry becomes the surface where the GM references NPCs, locations, plans, and notes during play — while GMhub remains the source-of-truth for **session prep** and **session recap**.

Sync is **explicit and manual**: the GM presses **Pull** to load GMhub content into Foundry, and **Push** to send their table-side work back. There is no live or background sync.

## Workflow position

```
GMhub (webapp)                          Foundry VTT
┌──────────────┐                       ┌──────────────┐
│  PREP        │                       │              │
│  - codex     │ ── Pull ─────────────▶│  LIVE        │
│  - notes     │                       │  - codex     │
│  - plan      │                       │  - notes     │
│              │                       │  - plan      │
│              │                       │  - reveals   │
│  RECAP       │ ◀─────────── Push ───│  - new ents  │
│  - quick-nts │                       │  - quick-nts │
│  - reveals   │                       │              │
└──────────────┘                       └──────────────┘
```

## In scope

### Sync model
- Manual push/pull buttons in Foundry; no background sync.
- 1 Foundry world ↔ 1 GMhub campaign (set once in module settings).
- Conflict policy: **direction wins**. Pull overwrites Foundry. Push overwrites GMhub. The GM picks the direction; the module does not merge.

### Content types pulled from GMhub
- **Entities** (NPCs, Locations, Factions, Items, Quests, Lore) — the codex.
- **Long-form notes** (GMhub `notes` table) — campaign-wide GM notes.
- **Active session plan** — `session_plan.gm_notes`, `agenda`, `gm_secrets`, pinned entities for the chosen session.

### Content types pushed back from Foundry
- **Visibility/reveal flips** on any GMhub-linked item.
- **New entries** created in Foundry (e.g., NPC invented mid-session).
- **Text edits** to existing entity/note content.
- **Quick notes** captured during play (pushed as `quick_notes` rows attached to the active session).
- **Session lifecycle events** (start/pause/resume/end) when initiated from Foundry.

### Foundry-side representation
- GMhub entities → **one JournalEntry per entity_kind**, six journals total: `NPCs`, `Locations`, `Factions`, `Items`, `Quests`, `Lore`. Each entity is a page within its kind-journal. New pages added in Foundry become new entities on push.
- GMhub long-form notes → their own JournalEntry (`Notes`) with one page per note.
- Session plan → a dedicated JournalEntry for the active session, with pages: `GM Notes`, `Agenda`, `GM Secrets` (GM-permission only), `Pinned`.

### Visibility & reveal
- The module **respects GMhub `note_visibility`** on pull (translated to Foundry permission ownership).
- `gm_only` and `private` content is never visible to player Foundry users; `gm_secrets` is GM-only forever.
- The GM can **flip visibility/reveal** on any synced item from inside Foundry during play. The change is applied locally to the Foundry doc immediately, then mirrored to GMhub on the next push (`entities.revealed_at` / `note_visibility` updated server-side for continuity).
- On pull, any reveals the GM made via the webapp since last sync are picked up.

### Session lifecycle
- GM can start/pause/resume/end the live session **from either side**; sync mirrors the change.
- When started from Foundry, the GM **picks an existing prepped session** from a GMhub list (no on-the-fly session creation in Foundry).
- GMhub remains the authority for the partial-unique-index "single active session per campaign" rule; conflicts surface as a clear error in Foundry.

## Out of scope

| Out of scope                                     | Why                                                                 |
|--------------------------------------------------|---------------------------------------------------------------------|
| Maps → Foundry Scenes                            | Foundry Scenes are richer than GMhub maps; don't replace them.      |
| Player characters → Foundry Actors               | Foundry's D&D 5e Actor sheet is canonical; PC data lives there.     |
| Live/realtime sync, websockets, webhooks         | Manual push/pull is the intended UX; no background traffic.         |
| Player Foundry users talking to GMhub            | Only the GM client authenticates with GMhub.                        |
| Non-GM-driven syncs                              | All sync is GM-initiated.                                           |
| Replacing Foundry-native features (combat tracker, dice, tokens, compendiums, scenes) | GMhub doesn't model these; module stays out of their way. |
| Encounter builder, AI assistant, Stripe          | Not module concerns.                                                |
| Timeline auto-events, relationship graph display | Webapp-side concerns; Foundry doesn't surface them in v1.           |

## Behaviour contracts

### Pull
1. GM clicks **Pull from GMhub** in the Journal sidebar.
2. Module fetches: campaign metadata, all entities (visibility-filtered to GM's role), all notes, the active session plan if one exists.
3. Module reconciles into the six kind-journals + Notes journal + session-plan journal:
   - Items with a known external-ID flag → updated in place.
   - Items unknown locally → created.
   - Items removed from GMhub → deleted from Foundry (or archived; design decision).
4. Foundry permissions reset to match GMhub visibility for each item.

### Push
1. GM clicks **Push to GMhub**.
2. Module collects everything GMhub-linked in Foundry (anything carrying the module's external-ID flag) plus any new pages in the kind-journals/Notes journal.
3. Module sends a single batched payload of: edits, new entries (with entity_kind inferred from parent journal), visibility changes, quick-notes captured this session.
4. GMhub responds with assigned IDs for new rows; the module writes those IDs back into Foundry flags so the next push updates instead of creating.

### Quick notes
- Foundry has a quick-capture surface (chat command `/qn ...`, or a sidebar button) available during a live session.
- Quick notes are queued in Foundry world flags so a brief network blip doesn't lose them.
- On push, queued notes are sent as `quick_notes` rows attached to the active GMhub session.

### Session boundary
- "Active session" in Foundry is set when the GM starts/picks one; it persists until end.
- All quick notes, reveals, and edits made between start and end are tagged with that session.
- Ending the session (from either side) does **not** trigger an automatic push — the GM still presses Push to send the table-side work to GMhub for the recap.

## Open design decisions (non-blocking)

These don't change scope but need answers before/during build:

1. **Authentication mechanism** — per-GM API key, email/password, or OAuth (deferred).
2. **Tombstoning vs. delete on pull** — when an entity is deleted in GMhub, does the Foundry page hard-delete or move to an Archive folder?
3. **GMhub Public API surface** — depends on Epic E shipping a `/api/v1` namespace; the module's contract list will mirror what Epic E exposes.
4. **Foundry version target** — v12 verified today, v13 as it stabilises; D&D 5e system version floor.
5. **Diff preview before push** — does the GM see "X entities will be created, Y updated, Z visibility flips" before confirming?
6. **Conflict signal on pull** — if Foundry has unpushed local edits when GM clicks Pull, do we warn ("you'll lose 3 unsaved edits") before overwriting?

## Cross-references

- **GMhub-app**: [`docs/SISTER_REPO.md`](https://github.com/b34rblack-glitch/GMhub-app/blob/main/docs/SISTER_REPO.md) is the webapp-side mirror of this scope (the resources GMhub exposes for this module). The GMhub Public API itself is tracked in their `docs/EPICS.md` (Epic E).
- **Roadmap impact**: this module relies on the GMhub `entities`, `notes`, `session_plan`, `quick_notes`, and `sessions` tables, plus a public REST surface. Module work cannot ship without those upstream.
