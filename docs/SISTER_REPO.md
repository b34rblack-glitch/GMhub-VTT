# Sister Repository — DMhub App

> The web application this Foundry module syncs with.
> Repo: https://github.com/b34rblack-glitch/DMhub-app
> Tracked there as **Epic G — Foundry VTT Module** (currently planned).
> Owns the `/api/v1` REST surface this module consumes (planned as **Epic E**).

---

## What it is

`dmhub-app` is the GMhub web application — a TTRPG campaign-management product running at https://gmhub.app. It hosts:

- The Postgres-backed canonical store of campaigns, sessions, entities, notes.
- The `/api/v1` REST surface this module consumes.
- The bearer-token issuance UI used for module configuration (planned — Epic E).

For its full vision and shipped-feature log, see that repo's `README.md` and `docs/EPICS.md`.

---

## Cross-repo contract

The two projects are coupled through one thing only: the `/api/v1` REST surface, **owned by `dmhub-app`** under Epic E.

### Ownership

- **`dmhub-app` owns the API surface.** Endpoint shapes, request/response payloads, auth model, and token issuance are all defined there. Until Epic E ships the contract is aspirational; this module runs against a stub server in the meantime.
- **`gmhub-vtt` (this repo) owns its consumption side and its scope.** What we sync (content types, push/pull semantics, conflict policy) is documented in [`../SCOPE.md`](../SCOPE.md). The wire format mirrors what Epic E exposes.

### Auth

Per-GM API tokens issued by `dmhub-app`, sent as `Authorization: Bearer <token>`. The token model lives in `dmhub-app` (Epic E) and is **not yet implemented there**.

### Rules of engagement

- **`dmhub-app` makes the call on shape changes.** If they change a payload, this module's `api-client.js` follows; bump `module.json#version` for any consumer-facing change.
- **This repo makes the call on scope.** If the set of content types we sync (or the push/pull semantics) changes, edit `SCOPE.md` first, then open a follow-up in `dmhub-app/docs/EPICS.md`.
- Both repos keep their `docs/EPICS.md` in sync at the cross-link points (Epic E / Epic G there ↔ GMV-* here).

## When to update this file

- The ownership of the API surface changes (e.g., this repo takes over part of it).
- The auth model changes (e.g., from bearer-token to OAuth).
- The set of repos in the ecosystem changes (e.g., a third repo joins).

Otherwise, leave this file alone — endpoint detail belongs in `dmhub-app`'s code/docs, scope detail belongs in this repo's `SCOPE.md`.
