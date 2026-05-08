# GMhub-VTT — Shipped Feature Log

> **The contract.** Append-only history of every release tagged in this repo.
> Module scope/intent lives in [`../SCOPE.md`](../SCOPE.md) — this file is the **changelog**; SCOPE is the **specification**.
> Sister-repo log: [`gmhub-app/docs/EPICS.md`](https://github.com/b34rblack-glitch/GMhub-app/blob/main/docs/EPICS.md)
> (cross-link upstream Epic E and Epic G).
>
> See `CLAUDE.md` §4 for the active focus and §0 for the full documentation contract.

## Releases

| Version | Tag | Summary |
|---|---|---|
| 0.1.0 | `v0.1.0` | Initial release. Two-way Journal sync (push/pull) with stable external IDs in journal flags. Per-journal context-menu action. Sync dialog from journal sidebar. Bearer-token auth with world-scoped GM-only settings. Manual sync only — no auto-push, no background polling. |
| 0.2.0 | `v0.2.0` | Epic E pulled. Module rewritten for the kind-journal mapping per `SCOPE.md` §"Foundry-side representation": six entity-kind journals + a Notes journal + a per-active-session journal with GM-only-forever GM Secrets page. Full E5/E6 client surface (`GmhubClient`), `pullAll` / `pushAll` covering entities + notes + plan + quick-notes + lifecycle, `pendingPushQueue` for offline capture, friendly error toasts (incl. 409 single-active-session), `Test Connection` button, `campaignId` + `activeSessionId` settings + Pick-Session dialog, `confirm-overwrite` dialog on Pull-when-dirty. GitHub Actions `release.yml` ships `module.zip` + versioned `module.json` on every `v*` tag. New `docs/integration-test.md` is the cross-repo gate. |
| 0.3.0 | `v0.3.0` | Closes the v0.2.0 feature gaps so a GM can run an entire session from Foundry without leaving for the GMhub web app. Adds: Start/Pause/Resume/End buttons on `SyncDialog` driven by the session state machine (GMHUB-159); Push diff preview dialog with `previewPush()` dry-run + cancel-without-API-write (GMHUB-160); Agenda & Pinned round-trip editor (GMHUB-161). Manifest `compatibility.maximum` bumped to `"13"` (GMHUB-162). |
| 0.3.1 | `v0.3.1` | Foundry v14 enablement. `module.json#compatibility.verified` and `maximum` both bumped to `"14"`. No code changes. |
| 0.3.2 | `v0.3.2` | v14 runtime hotfix. (a) `renderJournalDirectory` hook signature change; (b) defensive `i18nInit` fetch + `mergeObject` for the lang auto-load. Companion CORS fix in `gmhub-app`. |
| 0.3.3 | `v0.3.3` | v14 hotfix #2. Tiptap JSON → HTML on pull (`tiptapToHtml` walker in `sync.js`); journal sidebar re-render after lang merge so the sidebar Sync button picks up the localized label. |
| 0.3.4 | `v0.3.4` | v14 hotfix #3. Patches `game.i18n.localize` and `game.i18n.format` directly with a fallback to a manually-fetched flat dictionary. |
| 0.3.5 | `v0.3.5` | Agenda fidelity. Renders per-scene `entities: [{id, name, entityType}]` as chip spans after the scene notes. CSS rule for the v0.3.3 `.gmhub-mention` spans. |
| 0.3.6 | `v0.3.6` | Per-page eye icon now reveals to GMhub. The `updateJournalEntryPage` hook reverse-maps `page.ownership.default` to gmhub-app's `visibility` string and writes it into `flags.gmhub-vtt.visibility`. |
| 0.4.0 | `v0.4.0` | **Windowed multi-session pull.** Single-active-session model expands to: all prep sessions + the single most-recently-ended session + the running session each pulled as their own JournalEntry under an auto-created `GMhub Sessions` folder, with chronological `YYYY-MM-DD — <title>` naming. `activeSessionId` is now a *pointer* the SyncDialog targets, not "the only session". Per-journal **"Set as active session"** context-menu action. Push fans out across all session journals. Pull orphans deleted unless dirty. SCOPE.md amended in 0.4.0-α. |
| 0.4.1 | `v0.4.1` | **Pinned page render.** Replaces the flat `<li>npc: Brother Aldric</li>` list with per-pin cards: type chip + clickable Foundry content-link (`<a class="content-link" data-uuid="…">`) + first-paragraph blurb pulled from the entity's already-synced summary. Empty-state row when the pin references an entity not in this Foundry world. Drive-by: per-scene entity chips on the Agenda page also become clickable content-links when the referenced entity is synced. Forward-compatible with the cross-repo `pin_reason` feature (GMV-10): when the API starts returning `pin_reason`, the cards render it as a quoted blockquote line below the blurb — no second module release needed. New helpers `_findEntityPageById` and `_firstParagraphFromHtml` in `sync.js`; new CSS rules `.gmhub-pinned-list` / `.gmhub-pinned-card` / `.gmhub-pinned-header` / `.gmhub-pinned-type` / `.gmhub-pinned-name` / `.gmhub-pinned-blurb` / `.gmhub-pinned-reason`. |

## Open backlog

(Mirrors the README "Roadmap" section. Add tickets here as they're pulled into a release branch.)

| ID | Title | Notes |
|---|---|---|
| GMV-1 | Actor sync (5e sheets) | D&D 5e character sheets ↔ GMhub `player_characters`. Out of scope per current `SCOPE.md`; would require a scope amendment first. |
| GMV-2 | Scene / map import | Push Foundry scenes as `campaign_maps` rows in GMhub. Out of scope per current `SCOPE.md`; would require a scope amendment first. |
| GMV-3 | Webhook-driven live updates | Replace pull-on-demand with push notifications from `gmhub-app`. Out of scope per current `SCOPE.md` (manual-only); would require a scope amendment first. |
| GMV-5 | Migrate to ApplicationV2 | Sync dialog and editors use ApplicationV1, deprecated in v13+ but still functional in v14. Migration deferred to v0.5+. |
| GMV-6 | Push HTML ↔ Tiptap round-trip | Pull renders HTML correctly, but Push still sends raw `page.text.content` (HTML) to a JSON-expecting API. Server-side HTML acceptance in `gmhub-app` is the preferred fix. |
| GMV-7 | AgendaEditor: add/edit per-scene entity links | Existing scenes preserve their `entities` array on push, but the editor has no UI to attach/detach links. |
| GMV-8 | Manual fetch of older recaps | Outside the windowed pull, GMs may want one-off access to a specific past session. Tracked in `SCOPE.md` as open design decision #7. |
| GMV-9 | Per-session breakdown in PushPreviewDialog | 0.4.0-δ stores `preview.sessionPlanJournals: string[]` but the existing template still renders aggregated booleans. Enhance `templates/push-preview.hbs` to list per-session changes. |
| GMV-10 | Pin reason | Cross-repo. `gmhub-app` adds a `session_pins.pin_reason TEXT?` column + UI for capturing it on pin + serializes it in the `/api/v1/.../plan` response's pinned array. v0.4.1 of this module already renders the field when present (forward-compatible) — no second module release required, just the gmhub-app side. |

## Upstream dependencies (in `gmhub-app`)

| Their Epic | Why it matters here |
|---|---|
| **Epic E — Public API & Foundry Foundations** *(shipped 2026-05-08)* | Owns the `/api/v1` REST surface this module consumes, plus personal-access-token issuance. Live spec: [`/docs`](https://gmhub.app/docs); developer quickstart: [`PUBLIC_API.md`](https://github.com/b34rblack-glitch/GMhub-app/blob/main/docs/PUBLIC_API.md). |
| **Epic G — Foundry VTT Module** *(planned)* | Their tracking of *this repo*. Bidirectional: closing GMV-* features here typically translates into closing parts of Epic G there. |

## Reconciliation

If a feature lands in this module but isn't reflected in `gmhub-app`'s Epic G or vice-versa, log it here so the two logs can be synced on the next pass.

*(empty — no drift yet.)*
