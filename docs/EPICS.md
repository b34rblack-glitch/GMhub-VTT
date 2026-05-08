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
| 0.3.0 | `v0.3.0` | Closes the v0.2.0 feature gaps so a GM can run an entire session from Foundry without leaving for the GMhub web app. Adds: Start/Pause/Resume/End buttons on `SyncDialog` driven by the session state machine (GMHUB-159); Push diff preview dialog with `previewPush()` dry-run + cancel-without-API-write (GMHUB-160); Agenda & Pinned round-trip editor — structured payloads stored in page flags, edited via right-click "Edit (GMhub)", round-tripped on push (GMHUB-161). Manifest `compatibility.maximum` bumped to `"13"` so the module installs in Foundry v13 (GMHUB-162; `verified` stays at `"12"` until a v13 world runs the integration test). Drive-by: fixes pre-existing `GMhubClient` import-name typo that prevented module load. Tracked under GMHUB-158 epic. |
| 0.3.1 | `v0.3.1` | Foundry v14 enablement. `module.json#compatibility.verified` and `maximum` both bumped to `"14"`; README compat references updated. No code changes — v0.3.0 feature surface unchanged. Closes GMV-4 (the v13-verification debt is moot now that v14 is the verified target). |
| 0.3.2 | `v0.3.2` | v14 runtime hotfix. v0.3.1 installed in v14 but the UI didn't wire up: (a) `renderJournalDirectory` used `html.find()` against v13+'s raw `HTMLElement` and silently no-op'd, leaving no sidebar button — hook now branches on `instanceof HTMLElement`; (b) module-level language-pack auto-load stopped picking up `lang/en.json` in v14, every label rendered as the raw `GMHUB.*` key — added a defensive `i18nInit` fetch + `mergeObject` as a backstop. Companion CORS fix in `gmhub-app` resolves the "Failed to fetch" on Test Connection (PR linked in `gmhub-app/docs/EPICS.md`). |
| 0.3.3 | `v0.3.3` | v14 hotfix #2. Two bugs that only surfaced once content was actually pulled: (a) entity summaries, note bodies, and session plan `gm_notes` / `gm_secrets` rendered in journal pages as raw `{"type":"doc",...}` JSON because the API ships Tiptap ProseMirror-JSON and the module stored it verbatim with `format: 1` (HTML) — added `tiptapToHtml()` walker in `sync.js` and used it in all four pull paths; (b) the sidebar Sync button label baked in the raw i18n key because Foundry doesn't await async `i18nInit` listeners — `i18nInit` now calls `ui.journal?.render(false)` after merging the strings so the button gets a second pass. |
| 0.3.4 | `v0.3.4` | v14 hotfix #3 — the i18n one that finally takes. v0.3.4 stops trying to mutate Foundry's translation store and instead **patches `game.i18n.localize` and `game.i18n.format` directly** with a fallback to a manually-fetched flat dictionary; original implementations called first, fallback only kicks in when Foundry returns the raw key. Single patch covers Handlebars `{{localize}}` (templates), settings labels, dialog buttons, every direct `localize()` call. |
| 0.3.5 | `v0.3.5` | Agenda fidelity. `agendaHtml()` was a v0.3.0 implementation that only rendered scene title + duration + notes — the per-scene `entities: [{id, name, entityType}]` links the GM attaches in the web-app prep editor were dropped on the floor. v0.3.5 renders them as chip spans after the scene notes (CSS rule in `gmhub.css` matches the web app's rounded-pill look). Drive-by: `_escapeHtml` applied to scene title/notes + pinned name/type, plus a stylesheet rule for the v0.3.3 `.gmhub-mention` spans. Push round-trip already preserves the `entities` array via `FLAG_AGENDA_DATA`. Opens GMV-7 (AgendaEditorDialog can't add/edit per-scene entity links). |
| 0.3.6 | `v0.3.6` | Per-page eye icon now reveals to GMhub. The Journal sidebar's per-page eye toggle changes `page.ownership.default` between NONE (GM-only) and OBSERVER (campaign-visible); pre-0.3.6 the change was Foundry-local and the next Pull would overwrite it back. The `updateJournalEntryPage` hook reverse-maps the new ownership default to gmhub-app's `visibility` string and writes it into `flags.gmhub-vtt.visibility`. Session-plan pages skipped (GM-only-forever invariants). Drive-by: page-update hook now respects `autoPushOnUpdate`; `isUserChange` filter prevents re-entry recursion. |
| 0.4.0 | `v0.4.0` | **Windowed multi-session pull.** Single-active-session model expands to: all prep sessions + the single most-recently-ended session + the running session each pulled as their own JournalEntry under an auto-created `GMhub Sessions` folder, with chronological `YYYY-MM-DD — <title>` naming. `activeSessionId` is now a *pointer* the SyncDialog targets, not "the only session" — a per-journal **"Set as active session"** context-menu action flips it (GM gets a sidebar accent on the active row). Push fans out across all session journals so prep / recap edits round-trip without lifecycle gymnastics. Pull orphans (session journals outside the new window) are deleted unless dirty, in which case they're skipped with a warning toast (resolves open decision #2 in `SCOPE.md`). `result.pulled.sessions` is now a count (was: `sessionPlan: bool`); `result.pushed.sessionPlans` is a count of session journals pushed. SCOPE.md amended in 0.4.0-α before any code; staged across PRs α (scope) / β (windowed pull + folder + orphan cleanup) / γ (activation UX) / δ (push fan-out + version bump). Opens new low-priority debt: cross-campaign session-journal leakage on Push between campaign-switch and Pull. |

## Open backlog

(Mirrors the README "Roadmap" section. Add tickets here as they're pulled into a release branch.)

| ID | Title | Notes |
|---|---|---|
| GMV-1 | Actor sync (5e sheets) | D&D 5e character sheets ↔ GMhub `player_characters`. Out of scope per current `SCOPE.md`; would require a scope amendment first. |
| GMV-2 | Scene / map import | Push Foundry scenes as `campaign_maps` rows in GMhub. Out of scope per current `SCOPE.md`; would require a scope amendment first. |
| GMV-3 | Webhook-driven live updates | Replace pull-on-demand with push notifications from `gmhub-app`. Out of scope per current `SCOPE.md` (manual-only); would require a scope amendment first. |
| GMV-5 | Migrate to ApplicationV2 | Sync dialog and editors use ApplicationV1, deprecated in v13+ but still functional in v14. Migration deferred to v0.5+. |
| GMV-6 | Push HTML ↔ Tiptap round-trip | v0.3.3 made Pull render HTML correctly, but Push still sends raw `page.text.content` (HTML) to a JSON-expecting API. Either ship an HTML-to-Tiptap converter in this module, or extend `gmhub-app`'s entity/note/session-plan write routes to accept HTML and convert server-side. Server-side is preferred (one Tiptap engine, not two). Tracked as cross-repo work. |
| GMV-7 | AgendaEditor: add/edit per-scene entity links | Existing scenes preserve their `entities` array on push, but the editor has no UI to attach/detach links — a GM editing in Foundry can only adjust title/duration/notes. Adding a new scene leaves `entities` empty. Needs an entity picker (search the kind-journals?) wired into the editor. |
| GMV-8 | Manual fetch of older recaps | Outside the windowed pull, GMs may want one-off access to a specific past session ("what happened 4 sessions ago?"). Proposed surface: a `Pull session by ID` action in the SyncDialog that fetches one extra plan into the Sessions folder. Tracked in `SCOPE.md` as open design decision #7. |
| GMV-9 | Per-session breakdown in PushPreviewDialog | 0.4.0-δ stores `preview.sessionPlanJournals: string[]` (names of session journals with dirty pages) but the existing template still renders aggregated booleans ("gm_notes, agenda" without saying which sessions). Enhance `templates/push-preview.hbs` to list per-session changes when more than one is queued. |

## Upstream dependencies (in `gmhub-app`)

| Their Epic | Why it matters here |
|---|---|
| **Epic E — Public API & Foundry Foundations** *(shipped 2026-05-08)* | Owns the `/api/v1` REST surface this module consumes, plus personal-access-token issuance. Live spec: [`/docs`](https://gmhub.app/docs); developer quickstart: [`PUBLIC_API.md`](https://github.com/b34rblack-glitch/GMhub-app/blob/main/docs/PUBLIC_API.md). |
| **Epic G — Foundry VTT Module** *(planned)* | Their tracking of *this repo*. Bidirectional: closing GMV-* features here typically translates into closing parts of Epic G there. |

## Reconciliation

If a feature lands in this module but isn't reflected in `gmhub-app`'s Epic G or vice-versa, log it here so the two logs can be synced on the next pass.

*(empty — no drift yet.)*
