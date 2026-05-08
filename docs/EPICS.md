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

## Open backlog

(Mirrors the README "Roadmap" section. Add tickets here as they're pulled into a release branch.)

| ID | Title | Notes |
|---|---|---|
| GMV-1 | Actor sync (5e sheets) | D&D 5e character sheets ↔ GMhub `player_characters`. Out of scope per current `SCOPE.md`; would require a scope amendment first. |
| GMV-2 | Scene / map import | Push Foundry scenes as `campaign_maps` rows in GMhub. Out of scope per current `SCOPE.md`; would require a scope amendment first. |
| GMV-3 | Webhook-driven live updates | Replace pull-on-demand with push notifications from `gmhub-app`. Out of scope per current `SCOPE.md` (manual-only); would require a scope amendment first. |
| GMV-5 | Migrate to ApplicationV2 | Sync dialog and editors use ApplicationV1, deprecated in v13+ but still functional in v14. Migration deferred to v0.4.0. |

## Upstream dependencies (in `gmhub-app`)

| Their Epic | Why it matters here |
|---|---|
| **Epic E — Public API & Foundry Foundations** *(shipped 2026-05-08)* | Owns the `/api/v1` REST surface this module consumes, plus personal-access-token issuance. Live spec: [`/docs`](https://gmhub.app/docs); developer quickstart: [`PUBLIC_API.md`](https://github.com/b34rblack-glitch/GMhub-app/blob/main/docs/PUBLIC_API.md). |
| **Epic G — Foundry VTT Module** *(planned)* | Their tracking of *this repo*. Bidirectional: closing GMV-* features here typically translates into closing parts of Epic G there. |

## Reconciliation

If a feature lands in this module but isn't reflected in `gmhub-app`'s Epic G or vice-versa, log it here so the two logs can be synced on the next pass.

*(empty — no drift yet.)*
