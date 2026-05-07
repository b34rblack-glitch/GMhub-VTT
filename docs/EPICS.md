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
| **Epic E — Public API & Foundry Foundations** *(planned)* | Owns the `/api/v1` REST surface this module consumes, plus bearer-token issuance. Until it ships, this module's API contract is aspirational. |
| **Epic G — Foundry VTT Module** *(planned)* | Their tracking of *this repo*. Bidirectional: closing GMV-* features here typically translates into closing parts of Epic G there. |

## Reconciliation

If a feature lands in this module but isn't reflected in `dmhub-app`'s Epic G or vice-versa, log it here so the two logs can be synced on the next pass.

*(empty — no drift yet.)*
