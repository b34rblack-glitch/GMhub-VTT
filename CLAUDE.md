# GMhub-VTT — Claude Code Context

> Foundry VTT module that two-way-syncs Journal Entries with the GMhub web app.
> Keep this file under 140 lines. Update §4 "Current Focus" at the start of each
> new release. Everything else is stable reference.

## 0. Documentation Contract

Five files are the canonical documentation. Keep them in sync on every PR that ships:

1. **`README.md`** — landing page. Vision, status snapshot, install/config; defers to other docs for detail.
2. **`SCOPE.md`** — durable product scope and intent. Mission, workflow position, in-scope / out-of-scope, behaviour contracts, open design decisions. **Edit only when scope itself changes** — additions, removals, behavioural shifts. README and `docs/EPICS.md` reference this; do not duplicate scope material there.
3. **`docs/EPICS.md`** — append-only shipped-feature log + open backlog. **Add a row when any feature ships;** never edit historical rows.
4. **`CLAUDE.md`** *(this file)* — update §4 "Current Focus" at release start; update §5 "Known Issues" when you fix or add tech debt.
5. **`docs/SISTER_REPO.md`** — only edit when the cross-repo contract with `gmhub-app` changes (auth model, who owns the API surface, etc.).

**Do not create new top-level Markdown files** beyond these five. (No `AUDIT_REPORT.md`, no `audits/` snapshots, no `NOTES.md`.) One-shot reports go in PR descriptions.

When the user asks for an "audit" or "review", deliver findings inline in the conversation or as a PR description — not as a checked-in file.

## 1. Project Identity

| Key | Value |
|---|---|
| Repo | `github.com/b34rblack-glitch/GMhub-VTT` |
| Sister repo | `github.com/b34rblack-glitch/GMhub-app` (web app; tracks this repo as Epic G; owns the `/api/v1` surface as Epic E) |
| Module ID | `gmhub-vtt` |
| Current version | `0.3.6` |
| Foundry compat | v11 minimum, v14 verified, v14 maximum |
| System | `dnd5e` ≥ 3.0.0 |
| Manifest URL | `https://github.com/b34rblack-glitch/GMhub-VTT/releases/latest/download/module.json` |

## 2. Repo Structure

Top-level documentation (the five canonical files from §0):

```
README.md                # Landing page (vision + install + status)
SCOPE.md                 # Durable product scope/intent (read first)
CLAUDE.md                # This file (agent guardrails)
docs/EPICS.md            # Append-only shipped-feature log + backlog
docs/SISTER_REPO.md      # Cross-repo contract with gmhub-app
.github/
  pull_request_template.md  # PR documentation-contract reminder
  CODEOWNERS                # Default reviewer assignment
```

Source layout:

```
module.json              # Foundry manifest
scripts/
  main.js                # Module entry; hooks init, ready, getJournalDirectoryEntryContext; v14 i18n shim
  api-client.js          # REST client: ping, list, get, create, update; bearer auth
  sync.js                # Push/pull orchestration; tiptapToHtml; flag-based ID reconciliation
  ui.js                  # Sync dialog, sidebar button, settings registration
styles/
  gmhub.css              # Module-specific UI styling (chips, dialogs, sync button)
templates/               # Handlebars templates for the sync dialog
lang/
  en.json                # i18n strings
```

No build step — the module is plain ES modules loaded by Foundry directly.

## 3. Cross-repo contract (with `gmhub-app`)

This module is coupled to `gmhub-app` through exactly one surface: the `/api/v1` REST endpoints exposed under **Epic E — Public API & Foundry Foundations** in `gmhub-app`.

- **`gmhub-app` owns the API surface.** Endpoint shapes, auth model, and token issuance all live there. Until Epic E ships, the contract is aspirational; this module ships against a stub server in the meantime.
- **This module owns its consumption side and its scope.** What we sync (content types, push/pull semantics, conflict policy) is documented in `SCOPE.md`; the wire format mirrors what Epic E exposes.
- **Wire format detail:**
  - `entity.summary`, `note.body`, `session_plan.gm_notes`, `session_plan.gm_secrets` are Tiptap ProseMirror-JSON — rendered to HTML on pull via `tiptapToHtml` in `sync.js`. Push is currently lossy (sends HTML back, GMV-6).
  - `session_plan.agenda` is opaque JSON (`z.unknown()` server-side); canonical Scene shape in `gmhub-app/src/components/session-prep/scene-list.tsx`: `{ id, title, notes, entities: [{id, name, entityType}], estimated_duration_min, order, ticked }`. `agendaHtml()` in `sync.js` renders title + duration + notes + entity chips.
  - **Visibility ride-along.** Foundry's per-page eye icon (`page.ownership.default`) reverse-maps to gmhub-app's `visibility` field: `NONE` → `gm_only`, `OBSERVER` → `campaign`. The page-update hook in `main.js` writes the new value into `flags.gmhub-vtt.visibility` so the next Push includes it.
- Either side changes the contract → the other side's `docs/EPICS.md` gets a follow-up row.

See [`docs/SISTER_REPO.md`](docs/SISTER_REPO.md) for the long form.

## 4. Current Focus

> **Update this section at the start of every new release.**

`v0.3.6` wires the per-page **eye icon** in the Journal sidebar to gmhub-app's `visibility` field. Pre-0.3.6 the click toggled Foundry-local ownership but the change was lost on the next Pull (the GMhub-side state would overwrite it back). The `updateJournalEntryPage` hook now intercepts `change.ownership`, reverse-maps `ownership.default` (`NONE` / `OBSERVER`) to gmhub-app's `gm_only` / `campaign` strings, and writes the result into the page's `flags.gmhub-vtt.visibility` flag. `_pushEntityPage` and `_pushNotePage` already read from that flag, so the next manual Push propagates the toggle. Session-plan pages are skipped (GM-only-forever invariants don't surface as a `visibility` field). Drive-by: page-update hook now also auto-pushes the parent entry when `autoPushOnUpdate` is on (was only entry-level edits before — page-only edits were silently queued). README + CLAUDE §3 document the visibility ride-along.

## 5. Known Issues & Tech Debt

| Priority | Issue | Notes |
|---|---|---|
| 🟠 High | Push is lossy on rich-text fields | Pull renders Tiptap JSON → HTML, but Push sends `page.text.content` (HTML) back to gmhub-app whose API expects Tiptap JSON. A round-trip Pull → edit in Foundry → Push will either 400 or corrupt the body. Fix needs either an HTML → Tiptap converter in this module or HTML acceptance on the gmhub-app side. Tracked as GMV-6. |
| 🟡 Med | AgendaEditorDialog can't add/edit per-scene entity links | Existing scenes round-trip their `entities` array via the page flag, but the in-Foundry editor has no UI to attach or detach links. Adding a new scene in Foundry stores `entities: undefined` (treated as empty by the renderer + server). Tracked as GMV-7. |
| 🟡 Med | ApplicationV1 deprecation | ApplicationV1 still functional in v14 but officially deprecated. Sync dialog and editors are V1; migration to ApplicationV2 deferred to v0.4.0. |
| 🟢 Low | Eye toggle is buffered, not immediate | Per `SCOPE.md` "Manual sync only." The eye click maps to `flags.gmhub-vtt.visibility` and waits for the next Push (or auto-pushes when the opt-in setting is on). A GM expecting an instant flip needs `autoPushOnUpdate` enabled. |
| 🟢 Low | Root cause of v14 lang auto-load failure unknown | Three releases of escalating workarounds before the symptom was suppressed in v0.3.4. The underlying Foundry behaviour is undiagnosed; revisit if v15 / a v14 patch release re-breaks the workaround. |
| 🟢 Low | No automated tests | Foundry modules don't have an established test runner. Consider Quench or a stub Foundry environment if churn warrants it. |
| 🟢 Low | Bearer token stored in world settings (GM-visible) | Acceptable for a single-GM workflow; revisit if the module ever supports multiple GMs sharing one world. |

## 6. Coding Conventions

- **Plain ES modules** — no bundler, no transpile. Code must run in Foundry's V8 (modern Chromium) directly.
- **No external runtime deps** — keep `module.json#esmodules` to files in this repo.
- **Foundry hook discipline** — register hooks in `main.js`'s `init`/`ready` blocks; don't sprinkle `Hooks.on(...)` across utility files.
- **Stable IDs via flags** — every journal we sync stores `flags.gmhub-vtt.externalId`. Re-syncs key off this; never look up by name.
- **Bearer token in `world` scope** — settings registered with `scope: "world"`, `config: true`; only the GM sees the input.
- **Manual sync only.** Per `SCOPE.md`: no auto-push, no background polling, no websockets. If you find yourself adding one, the scope changed and `SCOPE.md` needs to be edited first. (`autoPushOnUpdate` is the explicit user-opt-in escape hatch.)

## 7. Useful Commands

```bash
# Local install
git clone https://github.com/b34rblack-glitch/GMhub-VTT.git "$FOUNDRY_DATA/modules/gmhub-vtt"
# Then enable in Foundry world settings.

# Cut a release (manual)
# 1. Bump module.json#version
# 2. Tag and push:  git tag v0.X.Y && git push origin v0.X.Y
# 3. Add release row in docs/EPICS.md
# 4. release.yml builds module.zip + versioned module.json on tag push
```

## 8. Claude Code Tips for This Repo

- The module is small (~700 LOC across 4 JS files); whole-file reads are fine.
- Always read `module.json` first when editing — the `esmodules`/`styles`/`languages` arrays gate what Foundry loads.
- **Read `SCOPE.md` before agreeing to a feature.** If a request would cross an out-of-scope line, surface that explicitly rather than implementing.
- Foundry's API is undocumented in `node_modules`; reference docs live at https://foundryvtt.com/api/v14/ — fetch live if needed.
- When `gmhub-app` changes the `/api/v1` surface (Epic E), this module's `api-client.js` follows. Bump `module.json#version` for any consumer-facing change.
- **Don't create `AUDIT_REPORT.md` or `audits/` files.** See §0 Documentation Contract — audit findings go in PR descriptions, not committed Markdown.
