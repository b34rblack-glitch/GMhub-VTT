# GMhub-VTT — Claude Code Context

> Foundry VTT module that two-way-syncs Journal Entries with the DMhub web app.
> Keep this file under 150 lines. Update §4 "Current Focus" at the start of each
> new release. Everything else is stable reference.

## 0. Documentation Contract

Four files are the canonical documentation. Keep them in sync on every PR that ships:

1. **`README.md`** — product vision, scope, status snapshot, **the authoritative REST API contract**. Update if vision/scope/contract changes.
2. **`docs/EPICS.md`** — append-only shipped-feature log + open backlog. **Add a row when any feature ships;** never edit historical rows.
3. **`CLAUDE.md`** *(this file)* — update §4 "Current Focus" at release start; update §5 "Known Issues" when you fix or add tech debt.
4. **`docs/SISTER_REPO.md`** — only edit when the cross-repo contract with `dmhub-app` changes (token model, base URL, auth header). Per-endpoint shapes live in this repo's `README.md`.

**Do not create new top-level Markdown files** (no `AUDIT_REPORT.md`, no `audits/` snapshots, no `NOTES.md`). One-shot reports go in PR descriptions.

When the user asks for an "audit" or "review", deliver findings inline in the conversation or as a PR description — not as a checked-in file.

## 1. Project Identity

| Key | Value |
|---|---|
| Repo | `github.com/b34rblack-glitch/GMhub-VTT` |
| Sister repo | `github.com/b34rblack-glitch/DMhub-app` (web app; tracks this repo as Epic G) |
| Module ID | `gmhub-vtt` |
| Current version | `0.1.0` |
| Foundry compat | v11 minimum, v12 verified, v12 maximum |
| System | `dnd5e` ≥ 3.0.0 |
| Manifest URL | `https://github.com/b34rblack-glitch/GMhub-VTT/releases/latest/download/module.json` |

## 2. Module Structure

```
module.json              # Foundry manifest
scripts/
  main.js                # Module entry; hooks init, ready, getJournalDirectoryEntryContext
  api-client.js          # REST client: ping, list, get, create, update; bearer auth
  sync.js                # Push/pull orchestration; flag-based ID reconciliation
  ui.js                  # Sync dialog, sidebar button, settings registration
styles/
  gmhub.css              # Module-specific UI styling
templates/               # Handlebars templates for the sync dialog
lang/
  en.json                # i18n strings
docs/
  EPICS.md               # Append-only release/feature log
  SISTER_REPO.md         # Cross-repo contract with dmhub-app
```

No build step — the module is plain ES modules loaded by Foundry directly.

## 3. Cross-repo contract (with `dmhub-app`)

This module is coupled to `dmhub-app` through exactly one surface: the `/api/v1` REST endpoints documented in this repo's `README.md`.

- **This repo owns the request/response shapes.** README is authoritative.
- **`dmhub-app` owns the bearer-token issuance model.** Tracked there as **Epic E — Public API & Foundry Foundations**.
- Either side changes the contract → the other side's `docs/EPICS.md` gets a follow-up row.

See [`docs/SISTER_REPO.md`](docs/SISTER_REPO.md) for the long form.

## 4. Current Focus

> **Update this section at the start of every new release.**

`v0.1.0` is the initial release. The upstream `/api/v1` surface is **not yet shipped in `dmhub-app`** (Epic E, planned). Until that lands, this module's REST contract is aspirational and end-to-end testing requires a stub server.

## 5. Known Issues & Tech Debt

| Priority | Issue | Notes |
|---|---|---|
| 🟡 Med | Foundry v13 not supported | Module declares max compat v12. Bumping to v13 likely needs an audit of `JournalEntryPage` API + the journal sidebar context-menu hook. Tracked as GMV-4 in `docs/EPICS.md`. |
| 🟢 Low | No automated tests | Foundry modules don't have an established test runner. Consider Quench or a stub Foundry environment if churn warrants it. |
| 🟢 Low | Bearer token stored in world settings (GM-visible) | Acceptable for a single-GM workflow; revisit if the module ever supports multiple GMs sharing one world. |

## 6. Coding Conventions

- **Plain ES modules** — no bundler, no transpile. Code must run in Foundry's V8 (modern Chromium) directly.
- **No external runtime deps** — keep `module.json#esmodules` to files in this repo.
- **Foundry hook discipline** — register hooks in `main.js`'s `init`/`ready` blocks; don't sprinkle `Hooks.on(...)` across utility files.
- **Stable IDs via flags** — every journal we sync stores `flags.gmhub-vtt.externalId`. Re-syncs key off this; never look up by name.
- **Bearer token in `world` scope** — settings registered with `scope: "world"`, `config: true`; only the GM sees the input.

## 7. Useful Commands

```bash
# Local install
git clone https://github.com/b34rblack-glitch/GMhub-VTT.git "$FOUNDRY_DATA/modules/gmhub-vtt"
# Then enable in Foundry world settings.

# Cut a release (manual)
# 1. Bump module.json#version
# 2. Tag and push:  git tag v0.X.Y && git push origin v0.X.Y
# 3. Add release row in docs/EPICS.md
# 4. Build a zip of the repo at the tag and attach to the GitHub release
```

## 8. Claude Code Tips for This Repo

- The module is small (~600 LOC across 4 JS files); whole-file reads are fine.
- Always read `module.json` first when editing — the `esmodules`/`styles`/`languages` arrays gate what Foundry loads.
- Foundry's API is undocumented in `node_modules`; reference docs live at https://foundryvtt.com/api/v12/ — fetch live if needed.
- When changing the REST contract in `README.md`, open a follow-up issue/PR in `dmhub-app` so its `/api/v1` implementation tracks. Bump this module's version in `module.json` so consumers can pin.
- **Don't create `AUDIT_REPORT.md` or `audits/` files.** See §0 Documentation Contract — audit findings go in PR descriptions, not committed Markdown.
