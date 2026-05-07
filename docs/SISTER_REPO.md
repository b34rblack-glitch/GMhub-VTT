# Sister Repository — DMhub App

> The web application this Foundry module syncs with.
> Repo: https://github.com/b34rblack-glitch/DMhub-app
> Tracked there as **Epic G — Foundry VTT Module** (currently planned).

---

## What it is

`dmhub-app` is the GMhub web application — a TTRPG campaign-management product running at https://gmhub.app. It hosts:

- The Postgres-backed canonical store of campaigns, sessions, entities, notes.
- The `/api/v1` REST surface this module talks to.
- The bearer-token issuance UI used for module configuration (planned — Epic E).

For its full vision and shipped-feature log, see that repo's `README.md` and `docs/EPICS.md`.

---

## Cross-repo contract

The two projects are coupled through one thing only: the `/api/v1` REST surface.

### Endpoints (this repo's `README.md` is the authoritative shape)

```
GET    /api/v1/ping
GET    /api/v1/journals[?updatedSince=<ISO>]
GET    /api/v1/journals/:id
POST   /api/v1/journals
PUT    /api/v1/journals/:id
DELETE /api/v1/journals/:id     (reserved; not called today)
```

### Auth

Per-GM API tokens issued by `dmhub-app`, sent as `Authorization: Bearer <token>`. The token model lives in `dmhub-app` (Epic E) and is **not yet implemented there**.

### Rules of engagement

- **`gmhub-vtt/README.md` (this repo) owns the request/response shapes.** If we change them here, follow up in `dmhub-app`.
- **`dmhub-app` owns the token model.** If their API-token surface changes, expect a docs follow-up in this repo.
- Both repos keep their `docs/EPICS.md` in sync at the cross-link points (Epic E / Epic G there ↔ GMV-* here).

## When to update this file

- A new endpoint is added or removed.
- The auth header changes.
- The token-issuance surface in `dmhub-app` changes.

Otherwise, leave this file alone — the per-endpoint detail lives in this repo's `README.md`. Editing here for cosmetic reasons creates exactly the drift the file exists to prevent.
