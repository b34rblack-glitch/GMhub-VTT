# GMhub-VTT — Project Scope

**Status:** Draft baseline — 2026-05-07 · amended 2026-05-08 (windowed multi-session pull, v0.4.0-α) · amended 2026-05-11 (selective handout reveal, v0.4.5)
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
- **Session plans (windowed)** — for the bound campaign, the module pulls:
  - all sessions in **prep** state (no `started_at`),
  - the **single most-recently-ended** session (largest `ended_at`) — the last recap,
  - the **currently running** session if one exists (live or paused).

  Older ended sessions remain on the web app and are not synced. The window is recomputed on every Pull; the "most-recently-ended" pointer moves forward as new sessions end. (Manual fetch of older recaps is tracked as a v0.5+ design decision; see § Open design decisions.)

### Content types pushed back from Foundry
- **Visibility/reveal flips** on any GMhub-linked item.
- **New entries** created in Foundry (e.g., NPC invented mid-session).
- **Text edits** to existing entity/note content.
- **Quick notes** captured during play (pushed as `quick_notes` rows attached to the active session).
- **Session lifecycle events** (start/pause/resume/end) when initiated from Foundry, targeting the active session.
- **Plan edits to any pulled session** — not only the active one. Editing a prep session's GM Notes / Agenda / Pinned in Foundry pushes back to that session on the next Push.

### Foundry-side representation
- GMhub entities → **one JournalEntry per entity_kind**, six journals total: `NPCs`, `Locations`, `Factions`, `Items`, `Quests`, `Lore`. Each entity is a page within its kind-journal. New pages added in Foundry become new entities on push.
- GMhub long-form notes → their own JournalEntry (`Notes`) with one page per note.
- Pulled session plans → **one JournalEntry per session** under an auto-created `GMhub Sessions` folder. Each session journal carries its session UUID in `flags.gmhub-vtt.externalId` and the same four pages: `GM Notes`, `Agenda`, `GM Secrets` (GM-only forever), `Pinned`. Naming format `YYYY-MM-DD — <title>` (date from `created_at`) so Foundry's alphabetic sort is chronological.

### Visibility & reveal
- The module **respects GMhub `note_visibility`** on pull (translated to Foundry permission ownership).
- `gm_only` and `private` content is never visible to player Foundry users; `gm_secrets` is GM-only forever.
- The GM can **flip visibility/reveal** on any synced item from inside Foundry during play. The change is applied locally to the Foundry doc immediately, then mirrored to GMhub on the next push (`entities.revealed_at` / `note_visibility` updated server-side for continuity). The per-page eye icon in the Journal sidebar is the canonical surface for this.
- On pull, any reveals the GM made via the webapp since last sync are picked up.
- **Selective per-player handout reveal (0015, v0.4.5).** Notes can additionally be revealed to a specific subset of campaign players via the `note_player_reveals` allowlist on GMhub. The module materialises this allowlist into Foundry's native per-user `JournalEntryPage.ownership` map: GM is OWNER, each selected player is OBSERVER, everyone else is NONE. The GM picks recipients in Foundry via the new "Reveal to specific players…" page context-menu entry; the change is sent to GMhub immediately via `PATCH /api/v1/.../notes/{id}/player-reveal` and the local ownership map is refreshed. This **loosens** the prior "no player Foundry users talking to GMhub" rule in a narrow way: per-page ownership must reference Foundry user ids, so the module ships a GM-managed slot mapping (`playerMap` world setting, edited via the new Player Mapping submenu) that translates GMhub user ids to Foundry user ids. **Players themselves still never authenticate with GMhub** — only the GM does.

### Session lifecycle
- GM can start/pause/resume/end the live session **from either side**; sync mirrors the change.
- When started from Foundry, the GM **picks an existing prepped session** from a GMhub list (no on-the-fly session creation in Foundry).
- GMhub remains the authority for the partial-unique-index "single active session per campaign" rule; conflicts surface as a clear error in Foundry.
- **Active session** in Foundry is now distinct from "session journals present in Foundry": multiple session journals can exist simultaneously (the prep set + last recap + running session). `activeSessionId` is the pointer that the SyncDialog's lifecycle buttons (Start/Pause/Resume/End) target. Per-`JournalEntry` context-menu action **"Set as active session"** flips the pointer; the existing Pick Session dialog stays as a fallback.
- When a session ends, the next Pull moves it from the running slot into the most-recent-recap slot and drops the previously-most-recent recap journal (per orphan handling below).

## Out of scope

| Out of scope                                     | Why                                                                 |
|--------------------------------------------------|---------------------------------------------------------------------|
| Maps → Foundry Scenes                            | Foundry Scenes are richer than GMhub maps; don't replace them.      |
| Player characters → Foundry Actors               | Foundry's D&D 5e Actor sheet is canonical; PC data lives there.     |
| Live/realtime sync, websockets, webhooks         | Manual push/pull is the intended UX; no background traffic.         |
| Player Foundry users authenticating with GMhub   | Still only the GM client authenticates. The 0015 slot mapping translates ids; it does not give players GMhub credentials. |
| Non-GM-driven syncs                              | All sync is GM-initiated.                                           |
| Replacing Foundry-native features (combat tracker, dice, tokens, compendiums, scenes) | GMhub doesn't model these; module stays out of their way. |
| Encounter builder, AI assistant, Stripe          | Not module concerns.                                                |
| Timeline auto-events, relationship graph display | Webapp-side concerns; Foundry doesn't surface them in v1.           |
| Full session history in Foundry                  | Pull is windowed (prep + last recap + running). Older recaps stay on the web app; manual one-shot fetch tracked as a v0.5+ proposal. |

## Behaviour contracts

### Pull
1. GM clicks **Pull from GMhub** in the Journal sidebar.
2. Module fetches: campaign metadata, all entities (visibility-filtered to GM's role), all notes (with their `revealed_to` allowlists), and the **session window** — all sessions in `prep`, the single session with the largest `ended_at`, and the running session if any. See § Content types pulled.
3. Module reconciles into the six kind-journals + Notes journal + per-session journals under the `GMhub Sessions` folder:
   - Items with a known external-ID flag → updated in place.
   - Items unknown locally → created.
   - Items removed from GMhub → deleted from Foundry (or archived; see open design decision #2).
4. Foundry permissions reset to match GMhub visibility for each item — including per-user ownership when a note has a non-empty `revealed_to` list.
5. If any note references a GMhub user id that is not yet in the `playerMap` mapping, Pull emits a single warning toast listing the missing ids so the GM can configure them via Module Settings → Configure player mapping.
6. **Orphan handling for session journals.** Session journals in the `GMhub Sessions` folder that fall outside the new window (e.g. a previous "most-recent recap" superseded by a fresh end) are **deleted** on Pull, *unless* they carry unpushed dirty edits — those are skipped with a warning toast so the GM can Push or manually resolve before the next Pull. This is consistent with the direction-wins conflict policy: Pull overwrites Foundry, but never destroys un-pushed local work silently.

### Push
1. GM clicks **Push to GMhub**.
2. Module collects everything GMhub-linked in Foundry (anything carrying the module's external-ID flag) plus any new pages in the kind-journals/Notes journal.
3. Module sends a single batched payload of: edits, new entries (with entity_kind inferred from parent journal), visibility changes, quick-notes captured this session, **and plan edits routed to whichever session journal carries the dirty page** (not just the active session).
4. GMhub responds with assigned IDs for new rows; the module writes those IDs back into Foundry flags so the next push updates instead of creating. **Selective reveal toggles are not part of the batched Push** — they're applied immediately when the GM saves the per-note Reveal Menu dialog, since they require an interactive recipient picker and the API endpoint is idempotent.

### Quick notes
- Foundry has a quick-capture surface (chat command `/qn ...`, or a sidebar button) available during a live session.
- Quick notes are queued in Foundry world flags so a brief network blip doesn't lose them.
- On push, queued notes are sent as `quick_notes` rows attached to the active GMhub session.

### Session boundary
- "Active session" in Foundry is set when the GM starts/picks one; it persists until end. The active pointer is independent of which session journals are present in Foundry — see § Session lifecycle.
- All quick notes, reveals, and edits made between start and end are tagged with that session.
- Ending the session (from either side) does **not** trigger an automatic push — the GM still presses Push to send the table-side work to GMhub for the recap.

## Open design decisions (non-blocking)

These don't change scope but need answers before/during build:

1. **Authentication mechanism** — per-GM API key, email/password, or OAuth (deferred).
2. **Tombstoning vs. delete on pull** — *resolved (v0.4.0-α):* delete on Pull, with the dirty-skip exception in § Behaviour contracts > Pull step 5. Applies to entities, notes, and session journals alike.
3. **GMhub Public API surface** — depends on Epic E shipping a `/api/v1` namespace; the module's contract list will mirror what Epic E exposes.
4. **Foundry version target** — v12 verified today, v13 as it stabilises; D&D 5e system version floor.
5. **Diff preview before push** — does the GM see "X entities will be created, Y updated, Z visibility flips" before confirming?
6. **Conflict signal on pull** — if Foundry has unpushed local edits when GM clicks Pull, do we warn ("you'll lose 3 unsaved edits") before overwriting?
7. **Manual fetch of older recaps** — outside the windowed pull, GMs may want one-off access to a specific past session ("what happened 4 sessions ago?"). Proposed surface: a `Pull session by ID` action in the SyncDialog that fetches one extra plan into the Sessions folder. Out of scope for v0.4.0; revisit in v0.5.

## Cross-references

- **GMhub-app**: [`docs/SISTER_REPO.md`](https://github.com/b34rblack-glitch/GMhub-app/blob/main/docs/SISTER_REPO.md) is the webapp-side mirror of this scope (the resources GMhub exposes for this module). The GMhub Public API itself is tracked in their `docs/EPICS.md` (Epic E).
- **Roadmap impact**: this module relies on the GMhub `entities`, `notes`, `session_plan`, `quick_notes`, and `sessions` tables, plus a public REST surface. Module work cannot ship without those upstream.
