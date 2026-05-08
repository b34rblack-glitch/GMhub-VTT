# GMhub-VTT — Shipped Feature Log

> **The contract.** Append-only history of every release tagged in this repo.
> Module scope/intent lives in [`../SCOPE.md`](../SCOPE.md) — this file is the **changelog**; SCOPE is the **specification**.
> Sister-repo log: [`dmhub-app/docs/EPICS.md`](https://github.com/b34rblack-glitch/DMhub-app/blob/main/docs/EPICS.md)
> (cross-link upstream Epic E and Epic G).
>
> See `CLAUDE.md` §4 for the active focus and §0 for the full documentation contract.

## Releases

| Version | Tag | Summary |
|---|---|---|
| 0.1.0 | `v0.1.0` | Initial release. Two-way Journal sync (push/pull) with stable external IDs in journal flags. Per-journal context-menu action. Sync dialog from journal sidebar. Bearer-token auth with world-scoped GM-only settings. Manual sync only — no auto-push, no background polling. |
| 0.2.0 | `v0.2.0` | Epic E pulled. Module rewritten for the kind-journal mapping per `SCOPE.md` §"Foundry-side representation": six entity-kind journals + a Notes journal + a per-active-session journal with GM-only-forever GM Secrets page. Full E5/E6 client surface (`GmhubClient`), `pullAll` / `pushAll` covering entities + notes + plan + quick-notes + lifecycle, `pendingPushQueue` for offline capture, friendly error toasts (incl. 409 single-active-session), `Test Connection` button, `campaignId` + `activeSessionId` settings + Pick-Session dialog, `confirm-overwrite` dialog on Pull-when-dirty. GitHub Actions `release.yml` ships `module.zip` + versioned `module.json` on every `v*` tag. New `docs/integration-test.md` is the cross-repo gate. |

## Open backlog

(Mirrors the README "Roadmap" section. Add tickets here as they're pulled into a release branch.)

| ID | Title | Notes |
|---|---|---|
| GMV-1 | Actor sync (5e sheets) | D&D 5e character sheets ↔ DMhub `player_characters`. Out of scope per current `SCOPE.md`; would require a scope amendment first. |
| GMV-2 | Scene / map import | Push Foundry scenes as `campaign_maps` rows in DMhub. Out of scope per current `SCOPE.md`; would require a scope amendment first. |
| GMV-3 | Webhook-driven live updates | Replace pull-on-demand with push notifications from `dmhub-app`. Out of scope per current `SCOPE.md` (manual-only); would require a scope amendment first. |
| GMV-4 | Foundry v13 compatibility | Audit `JournalEntryPage` API + sidebar context-menu hook; bump `module.json#compatibility.maximum`. In scope. |

## Upstream dependencies (in `dmhub-app`)

| Their Epic | Why it matters here |
|---|---|
| **Epic E — Public API & Foundry Foundations** *(shipped 2026-05-08)* | Owns the `/api/v1` REST surface this module consumes, plus personal-access-token issuance. Live spec: [`/docs`](https://gmhub.app/docs); developer quickstart: [`PUBLIC_API.md`](https://github.com/b34rblack-glitch/DMhub-app/blob/main/docs/PUBLIC_API.md). |
| **Epic G — Foundry VTT Module** *(planned)* | Their tracking of *this repo*. Bidirectional: closing GMV-* features here typically translates into closing parts of Epic G there. |

## Reconciliation

If a feature lands in this module but isn't reflected in `dmhub-app`'s Epic G or vice-versa, log it here so the two logs can be synced on the next pass.

*(empty — no drift yet.)*
