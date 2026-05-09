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
| 0.2.0 | `v0.2.0` | Epic E pulled. Module rewritten for the kind-journal mapping per `SCOPE.md` §"Foundry-side representation": six entity-kind journals + a Notes journal + a per-active-session journal with GM-only-forever GM Secrets page. Full E5/E6 client surface, `pullAll` / `pushAll`, `pendingPushQueue`, friendly error toasts, Test Connection button, Pick-Session dialog, ConfirmOverwrite dialog. GitHub Actions `release.yml` ships `module.zip` + versioned `module.json` on every `v*` tag. |
| 0.3.0 | `v0.3.0` | Closes the v0.2.0 feature gaps: lifecycle buttons on SyncDialog, Push diff preview, Agenda & Pinned round-trip editor. Manifest `compatibility.maximum` bumped to `"13"`. |
| 0.3.1 | `v0.3.1` | Foundry v14 enablement. Manifest verified=14, maximum=14. |
| 0.3.2 | `v0.3.2` | v14 runtime hotfix #1. renderJournalDirectory hook signature fix; defensive `i18nInit` lang fetch. Companion CORS fix in `gmhub-app`. |
| 0.3.3 | `v0.3.3` | v14 hotfix #2. `tiptapToHtml` walker; journal sidebar re-render after lang merge. |
| 0.3.4 | `v0.3.4` | v14 hotfix #3. Patches `game.i18n.localize` and `game.i18n.format` directly with a fallback to a manually-fetched flat dictionary. |
| 0.3.5 | `v0.3.5` | Agenda fidelity. Per-scene `entities` chip render. CSS rule for `.gmhub-mention`. |
| 0.3.6 | `v0.3.6` | Per-page eye icon now reveals to GMhub. `updateJournalEntryPage` reverse-maps `ownership.default` to `visibility`. |
| 0.4.0 | `v0.4.0` | **Windowed multi-session pull.** Single-active-session expands to: prep + most-recent ended + running session each as their own JournalEntry under an auto-created `GMhub Sessions` folder. `activeSessionId` becomes a pointer; per-journal "Set as active session" context-menu action. Push fans out across all session journals. Pull orphans deleted unless dirty. SCOPE.md amended in 0.4.0-α. |
| 0.4.1 | `v0.4.1` | **Pinned page render + Handlebars helper re-register.** Replaces the flat `<li>npc: Brother Aldric</li>` list with per-pin cards: type chip + clickable Foundry content-link + first-paragraph blurb. Drive-by: per-scene entity chips on the Agenda page also become clickable content-links when the referenced entity is synced. Forward-compatible with the cross-repo `pin_reason` feature (GMV-10) — cards render the field as a quoted blockquote when the API returns it. Late addition: re-registers Handlebars `{{localize}}` / `{{localizeFormat}}` helpers in `i18nInit` so dialog template labels (which Foundry v14 binds with the original `game.i18n.localize` reference) finally pick up the v0.3.4 patched fallback. |
| 0.4.2 | `v0.4.2` | **Forced republish of v0.4.1.** Pure version-number bump so Foundry's update check sees a new release after the Handlebars-helper hotfix landed mid-`v0.4.1`. No code change vs. v0.4.1's final commit. Re-tagging onto an existing version doesn't trigger Foundry's update flow (it compares `module.json#version`, not commit SHA), so the Handlebars fix wasn't reaching deployed instances. v0.4.2 is the workaround. Future: when shipping a fix mid-release, bump version BEFORE tagging. |

## Open backlog

(Mirrors the README "Roadmap" section. Add tickets here as they're pulled into a release branch.)

| ID | Title | Notes |
|---|---|---|
| GMV-1 | Actor sync (5e sheets) | D&D 5e character sheets ↔ GMhub `player_characters`. Out of scope per current `SCOPE.md`. |
| GMV-2 | Scene / map import | Push Foundry scenes as `campaign_maps` rows in GMhub. Out of scope per current `SCOPE.md`. |
| GMV-3 | Webhook-driven live updates | Replace pull-on-demand with push notifications from `gmhub-app`. Out of scope per current `SCOPE.md` (manual-only). |
| GMV-5 | Migrate to ApplicationV2 | Sync dialog and editors use ApplicationV1, deprecated in v13+ but still functional in v14. |
| GMV-6 | Push HTML ↔ Tiptap round-trip | Pull renders HTML correctly; Push still sends raw HTML to a JSON-expecting API. Server-side HTML acceptance in `gmhub-app` is the preferred fix. |
| GMV-7 | AgendaEditor: add/edit per-scene entity links | Existing scenes preserve `entities` on push; the editor has no UI to attach/detach links. |
| GMV-8 | Manual fetch of older recaps | Outside the windowed pull, GMs may want one-off access to a specific past session. Tracked in `SCOPE.md` as open design decision #7. |
| GMV-9 | Per-session breakdown in PushPreviewDialog | `preview.sessionPlanJournals` is populated; the existing template still renders aggregated booleans. |
| GMV-10 | Pin reason (cross-repo) | gmhub-app side shipped 2026-05-09. v0.4.1 of this module renders `pin_reason` when the API returns it (forward-compatible). |

## Upstream dependencies (in `gmhub-app`)

| Their Epic | Why it matters here |
|---|---|
| **Epic E — Public API & Foundry Foundations** *(shipped 2026-05-08)* | Owns the `/api/v1` REST surface this module consumes, plus personal-access-token issuance. |
| **Epic G — Foundry VTT Module** *(planned)* | Their tracking of *this repo*. Bidirectional: closing GMV-* features here typically translates into closing parts of Epic G there. |

## Reconciliation

If a feature lands in this module but isn't reflected in `gmhub-app`'s Epic G or vice-versa, log it here so the two logs can be synced on the next pass.

*(empty — no drift yet.)*
