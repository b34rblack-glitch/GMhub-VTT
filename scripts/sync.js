// GMhub VTT Bridge — Pull/Push orchestration (GMHUB-155 / E12).
//
// Maps GMhub content to Foundry's journal model per GMhub-VTT/SCOPE.md
// §"Foundry-side representation":
//
//   entities (NPCs, Locations, Factions, Items, Quests, Lore)
//     → six JournalEntries, one per entity_kind (NPCs / Locations / …).
//     → each entity is a page within its kind-journal.
//   notes
//     → a single "Notes" JournalEntry, one page per note.
//   session_plan (active session only)
//     → a dedicated session JournalEntry with four pages:
//        GM Notes, Agenda, GM Secrets (page-ownership GM-only forever),
//        Pinned.
//
// Conflict policy is direction-wins (per SCOPE): Pull overwrites Foundry,
// Push overwrites GMhub. No merge, no per-field reconciliation.
//
// Stable IDs travel via flags.gmhub-vtt.externalId on every synced page.
// Re-syncs key off the flag; we never look up by name.

import { MODULE_ID } from "./main.js";

const FLAG_KIND = "kind"; // "npc" | "location" | … | "notes" | "session"
const FLAG_EXTERNAL_ID = "externalId";
const FLAG_VISIBILITY = "visibility";
const FLAG_REVEALED_AT = "revealedAt";
const FLAG_DIRTY = "dirty";
const FLAG_ENTITY_TYPE = "entityType";
// Structured payloads stashed alongside the rendered HTML on agenda/pinned
// session-plan pages, so AgendaEditorDialog can round-trip edits back to the
// API shape on push. (GMHUB-161)
const FLAG_AGENDA_DATA = "agendaItems";
const FLAG_PINNED_DATA = "pinnedRefs";

const KIND_JOURNAL_NAMES = {
  npc: "NPCs",
  location: "Locations",
  faction: "Factions",
  item: "Items",
  quest: "Quests",
  lore: "Lore"
};

const NOTES_JOURNAL_NAME = "Notes";

const SESSION_PAGE_GM_NOTES = "GM Notes";
const SESSION_PAGE_AGENDA = "Agenda";
const SESSION_PAGE_SECRETS = "GM Secrets";
const SESSION_PAGE_PINNED = "Pinned";

function sessionJournalName(sessionTitle) {
  return `Session: ${sessionTitle ?? "(untitled)"}`;
}

// ---- Tiptap ProseMirror-JSON → HTML ------------------------------------
//
// gmhub-app stores long-form fields (entity.summary, note.body,
// session_plan.gm_notes, session_plan.gm_secrets) as Tiptap doc JSON. The
// API surfaces it verbatim. Foundry's JournalEntryPage `text.content` with
// `format: 1` (HTML) renders any non-HTML string as a literal, which is
// why v0.3.2 surfaced raw `{"type":"doc",...}` blobs in the page body.
// This walker handles the standard ProseMirror nodes/marks plus the
// GMhub-specific `mention` extension. Unknown nodes render their content
// lossily (text-only).

function _escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _applyMarks(html, marks) {
  if (!Array.isArray(marks) || marks.length === 0) return html;
  let out = html;
  for (const mark of marks) {
    switch (mark?.type) {
      case "bold":      out = `<strong>${out}</strong>`; break;
      case "italic":    out = `<em>${out}</em>`; break;
      case "underline": out = `<u>${out}</u>`; break;
      case "strike":    out = `<s>${out}</s>`; break;
      case "code":      out = `<code>${out}</code>`; break;
      case "link": {
        const href = _escapeHtml(mark.attrs?.href ?? "#");
        out = `<a href="${href}" rel="noopener noreferrer">${out}</a>`;
        break;
      }
      // Unknown marks: don't wrap. Better to lose styling than to emit junk.
    }
  }
  return out;
}

function _nodeToHtml(node) {
  if (!node || typeof node !== "object") return "";
  const kids = Array.isArray(node.content) ? node.content.map(_nodeToHtml).join("") : "";
  switch (node.type) {
    case "doc":
      return kids;
    case "paragraph":
      // Empty paragraphs render as a non-breaking space so the spacing
      // matches the web app's editor view.
      return `<p>${kids || "&nbsp;"}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return `<h${level}>${kids}</h${level}>`;
    }
    case "text":
      return _applyMarks(_escapeHtml(node.text), node.marks);
    case "hardBreak":
    case "hard_break":
      return "<br>";
    case "horizontalRule":
    case "horizontal_rule":
      return "<hr>";
    case "bulletList":
    case "bullet_list":
      return `<ul>${kids}</ul>`;
    case "orderedList":
    case "ordered_list":
      return `<ol>${kids}</ol>`;
    case "listItem":
    case "list_item":
      return `<li>${kids}</li>`;
    case "blockquote":
      return `<blockquote>${kids}</blockquote>`;
    case "codeBlock":
    case "code_block":
      return `<pre><code>${kids}</code></pre>`;
    case "mention": {
      // GMhub's custom mention extension: { id, label, entityType, campaignId }.
      // We render an inline span with data-* attrs so future work can wire
      // up click-to-open-entity without changing the stored HTML.
      const label = _escapeHtml(node.attrs?.label ?? node.attrs?.id ?? "");
      const entityType = _escapeHtml(node.attrs?.entityType ?? "");
      const id = _escapeHtml(node.attrs?.id ?? "");
      return `<span class="gmhub-mention" data-entity-type="${entityType}" data-entity-id="${id}">@${label}</span>`;
    }
    default:
      // Unknown node type: render its children, drop the wrapper.
      return kids;
  }
}

// Convert a Tiptap doc to HTML. Accepts the parsed object, a JSON string
// of the doc, plain HTML (returned as-is), or null/undefined (returns "").
// Heuristic: a string starting with `{` and ending with `}` is treated as
// JSON; anything else is passed through (covers existing pre-Tiptap rows
// where the column already holds HTML, and the empty-string default).
export function tiptapToHtml(input) {
  if (input == null) return "";
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return _nodeToHtml(JSON.parse(trimmed));
      } catch {
        return input;
      }
    }
    return input;
  }
  if (typeof input === "object") return _nodeToHtml(input);
  return "";
}

// Foundry's CONST.DOCUMENT_OWNERSHIP_LEVELS — read at runtime so we don't
// import the Foundry global at module-load time.
function ownershipLevels() {
  return {
    NONE: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
    OBSERVER: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
    OWNER: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
  };
}

function gmUserId() {
  // game.users may have multiple GMs; pick the active one. The module is
  // single-GM by design (CLAUDE.md §5 known issue).
  return game.users.find((u) => u.isGM)?.id ?? game.user.id;
}

// Map GMhub four-value visibility → Foundry page-level ownership map.
// gm_secrets is treated separately by callers (always pinned to GM-only).
export function entityVisibilityToOwnership(visibility) {
  const { NONE, OBSERVER, OWNER } = ownershipLevels();
  const gmId = gmUserId();
  switch (visibility) {
    case "private":
    case "gm_only":
      return { default: NONE, [gmId]: OWNER };
    case "players_only":
    case "campaign":
    default:
      return { default: OBSERVER, [gmId]: OWNER };
  }
}

export const SESSION_PLAN_FLAGS = {
  agenda: FLAG_AGENDA_DATA,
  pinned: FLAG_PINNED_DATA
};

export const SESSION_PLAN_PAGE_NAMES = {
  agenda: SESSION_PAGE_AGENDA,
  pinned: SESSION_PAGE_PINNED
};

export function renderAgendaHtml(agenda) {
  return agendaHtml(agenda);
}

export function renderPinnedHtml(pinned) {
  return pinnedHtml(pinned);
}

function pinnedHtml(pinned) {
  if (!Array.isArray(pinned) || pinned.length === 0) {
    return "<p><em>No pinned entities.</em></p>";
  }
  const items = pinned
    .map((p) => {
      const type = _escapeHtml(p?.entity_type ?? "");
      const name = _escapeHtml(p?.name ?? "");
      return `<li><strong>${type}</strong>: ${name}</li>`;
    })
    .join("\n");
  return `<ul>\n${items}\n</ul>`;
}

// Render a session-plan agenda scene-by-scene. Scene shape (from
// gmhub-app/src/components/session-prep/scene-list.tsx):
//   { id, title, notes, entities: [{ id, name, entityType }],
//     estimated_duration_min, order, ticked }
// Pre-v0.3.5 dropped scene.entities entirely; v0.3.5 renders them as
// chip spans after the scene notes so the linked NPCs / locations /
// items the GM attached on the web side carry through to Foundry.
function agendaHtml(agenda) {
  if (!Array.isArray(agenda) || agenda.length === 0) {
    return "<p><em>No agenda items.</em></p>";
  }
  const items = agenda
    .map((scene) => {
      const title = _escapeHtml(scene?.title ?? "(untitled)");
      const dur = scene?.estimated_duration_min
        ? ` <em>(${Number(scene.estimated_duration_min)}m)</em>`
        : "";
      const notes = scene?.notes ? `<p>${_escapeHtml(scene.notes)}</p>` : "";
      const entitiesArr = Array.isArray(scene?.entities) ? scene.entities : [];
      const entities = entitiesArr.length
        ? `<p class="gmhub-scene-entities">${entitiesArr
            .map((e) => {
              const name = _escapeHtml(e?.name ?? "");
              const type = _escapeHtml(e?.entityType ?? "");
              const id = _escapeHtml(e?.id ?? "");
              return `<span class="gmhub-scene-entity-chip" data-entity-type="${type}" data-entity-id="${id}">${name}</span>`;
            })
            .join(" ")}</p>`
        : "";
      return `<li><strong>${title}</strong>${dur}${notes}${entities}</li>`;
    })
    .join("\n");
  return `<ol>\n${items}\n</ol>`;
}

export class SyncService {
  constructor(client) {
    this.client = client;
  }

  // ---- shared journal helpers ----

  async _findOrCreateJournal(name, kind, extraFlags = {}) {
    const existing = game.journal.contents.find(
      (e) => e.getFlag(MODULE_ID, FLAG_KIND) === kind
    );
    if (existing) {
      if (existing.name !== name) {
        await existing.update({ name });
      }
      return existing;
    }
    return JournalEntry.create({
      name,
      flags: { [MODULE_ID]: { [FLAG_KIND]: kind, ...extraFlags } }
    });
  }

  _findPageByExternalId(journal, externalId) {
    return (
      journal.pages.contents.find(
        (p) => p.getFlag(MODULE_ID, FLAG_EXTERNAL_ID) === externalId
      ) ?? null
    );
  }

  _entityPagePayload(entity) {
    return {
      name: entity.name,
      type: "text",
      text: { content: tiptapToHtml(entity.summary), format: 1 /* HTML */ },
      ownership: entityVisibilityToOwnership(entity.visibility),
      flags: {
        [MODULE_ID]: {
          [FLAG_EXTERNAL_ID]: entity.id,
          [FLAG_ENTITY_TYPE]: entity.entity_type,
          [FLAG_VISIBILITY]: entity.visibility,
          [FLAG_REVEALED_AT]: entity.revealed_at,
          [FLAG_DIRTY]: false
        }
      }
    };
  }

  _notePagePayload(note) {
    return {
      name: note.title ?? "Untitled note",
      type: "text",
      text: { content: tiptapToHtml(note.body), format: 1 },
      ownership: entityVisibilityToOwnership(note.visibility),
      flags: {
        [MODULE_ID]: {
          [FLAG_EXTERNAL_ID]: note.id,
          [FLAG_VISIBILITY]: note.visibility,
          [FLAG_DIRTY]: false
        }
      }
    };
  }

  async _upsertPage(journal, externalId, payload) {
    const existing = this._findPageByExternalId(journal, externalId);
    if (existing) {
      await journal.updateEmbeddedDocuments("JournalEntryPage", [
        { _id: existing.id, ...payload }
      ]);
      return existing.id;
    }
    const [created] = await journal.createEmbeddedDocuments("JournalEntryPage", [payload]);
    return created.id;
  }

  // ---- dirty-detection ----

  _findDirtyEntries() {
    return game.journal.contents.filter((entry) => {
      if (entry.getFlag(MODULE_ID, FLAG_DIRTY)) return true;
      return entry.pages.contents.some((p) => p.getFlag(MODULE_ID, FLAG_DIRTY));
    });
  }

  // ---- Pull ----

  async pullAll({ confirmOverwrite } = {}) {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) {
      return { cancelled: false, error: "no_campaign_bound" };
    }
    const activeSessionId = game.settings.get(MODULE_ID, "activeSessionId");

    const dirty = this._findDirtyEntries();
    if (dirty.length && typeof confirmOverwrite === "function") {
      const confirmed = await confirmOverwrite(dirty);
      if (!confirmed) return { cancelled: true };
    }

    const result = {
      pulled: { entities: 0, notes: 0, sessionPlan: false },
      errors: []
    };

    // Entities — six kind-journals.
    for (const [kind, journalName] of Object.entries(KIND_JOURNAL_NAMES)) {
      try {
        const journal = await this._findOrCreateJournal(journalName, kind);
        for await (const entity of this.client.iterateAll(
          (opts) => this.client.listEntities(campaignId, { ...opts, type: kind, limit: 100 }),
          {}
        )) {
          await this._upsertPage(journal, entity.id, this._entityPagePayload(entity));
          result.pulled.entities += 1;
        }
        await journal.unsetFlag(MODULE_ID, FLAG_DIRTY).catch(() => {});
      } catch (err) {
        result.errors.push({ name: journalName, message: err.message ?? String(err) });
      }
    }

    // Notes — single journal.
    try {
      const notesJournal = await this._findOrCreateJournal(NOTES_JOURNAL_NAME, "notes");
      for await (const note of this.client.iterateAll(
        (opts) => this.client.listNotes(campaignId, { ...opts, limit: 100 }),
        {}
      )) {
        await this._upsertPage(notesJournal, note.id, this._notePagePayload(note));
        result.pulled.notes += 1;
      }
      await notesJournal.unsetFlag(MODULE_ID, FLAG_DIRTY).catch(() => {});
    } catch (err) {
      result.errors.push({ name: NOTES_JOURNAL_NAME, message: err.message ?? String(err) });
    }

    // Session plan — only if a session is bound.
    if (activeSessionId) {
      try {
        const session = await this.client.getSession(campaignId, activeSessionId);
        const plan = await this.client.getSessionPlan(campaignId, activeSessionId);
        const journal = await this._findOrCreateJournal(
          sessionJournalName(session.title),
          "session",
          { [FLAG_EXTERNAL_ID]: activeSessionId }
        );
        const { NONE, OWNER } = ownershipLevels();
        const gmOnly = { default: NONE, [gmUserId()]: OWNER };

        await this._upsertPage(journal, `${activeSessionId}:gm_notes`, {
          name: SESSION_PAGE_GM_NOTES,
          type: "text",
          text: { content: tiptapToHtml(plan.gm_notes), format: 1 },
          ownership: gmOnly,
          flags: { [MODULE_ID]: { [FLAG_EXTERNAL_ID]: `${activeSessionId}:gm_notes`, [FLAG_DIRTY]: false } }
        });
        await this._upsertPage(journal, `${activeSessionId}:agenda`, {
          name: SESSION_PAGE_AGENDA,
          type: "text",
          text: { content: agendaHtml(plan.agenda), format: 1 },
          ownership: gmOnly,
          flags: {
            [MODULE_ID]: {
              [FLAG_EXTERNAL_ID]: `${activeSessionId}:agenda`,
              [FLAG_DIRTY]: false,
              [FLAG_AGENDA_DATA]: Array.isArray(plan.agenda) ? plan.agenda : []
            }
          }
        });
        // GM Secrets is included only when the token's scope permitted it
        // (the server omits the field otherwise — absence is the signal).
        if (Object.prototype.hasOwnProperty.call(plan, "gm_secrets")) {
          await this._upsertPage(journal, `${activeSessionId}:gm_secrets`, {
            name: SESSION_PAGE_SECRETS,
            type: "text",
            text: { content: tiptapToHtml(plan.gm_secrets), format: 1 },
            ownership: gmOnly, // GM-only forever — page-level invariant.
            flags: { [MODULE_ID]: { [FLAG_EXTERNAL_ID]: `${activeSessionId}:gm_secrets`, [FLAG_DIRTY]: false } }
          });
        }
        await this._upsertPage(journal, `${activeSessionId}:pinned`, {
          name: SESSION_PAGE_PINNED,
          type: "text",
          text: { content: pinnedHtml(plan.pinned), format: 1 },
          ownership: gmOnly,
          flags: {
            [MODULE_ID]: {
              [FLAG_EXTERNAL_ID]: `${activeSessionId}:pinned`,
              [FLAG_DIRTY]: false,
              [FLAG_PINNED_DATA]: Array.isArray(plan.pinned) ? plan.pinned : []
            }
          }
        });
        result.pulled.sessionPlan = true;
      } catch (err) {
        result.errors.push({ name: "session-plan", message: err.message ?? String(err) });
      }
    }

    await game.settings.set(MODULE_ID, "lastPullAt", new Date().toISOString());
    return result;
  }

  // ---- Push ----

  // Drain the world-flag-backed quick-note queue first, per GMhub-VTT SCOPE
  // §Behaviour contracts: "Quick notes are queued in Foundry world flags so
  // a brief network blip doesn't lose them." Successful entries are removed
  // from the queue; failed ones stay for the next push.
  async _drainQuickNoteQueue(campaignId, sessionId, result) {
    if (!sessionId) return;
    const queue = game.settings.get(MODULE_ID, "pendingPushQueue") ?? [];
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try {
        await this.client.addQuickNote(campaignId, sessionId, {
          body: item.body,
          mentioned_entity_id: item.mentioned_entity_id ?? null
        });
        result.pushed.quickNotes += 1;
      } catch (err) {
        remaining.push(item);
        result.errors.push({
          name: "quick-note",
          message: err.message ?? String(err)
        });
      }
    }
    await game.settings.set(MODULE_ID, "pendingPushQueue", remaining);
  }

  async _pushEntityPage(campaignId, kind, page, result) {
    const externalId = page.getFlag(MODULE_ID, FLAG_EXTERNAL_ID);
    const visibility = page.getFlag(MODULE_ID, FLAG_VISIBILITY) ?? "campaign";
    const payload = {
      entity_type: kind,
      name: page.name,
      summary: page.text?.content ?? "",
      visibility
    };
    try {
      let row;
      if (externalId) {
        row = await this.client.updateEntity(campaignId, externalId, {
          name: payload.name,
          summary: payload.summary,
          visibility: payload.visibility
        });
      } else {
        row = await this.client.createEntity(campaignId, payload);
        // Write the assigned id back so the next push updates instead of
        // creating a duplicate.
        await page.setFlag(MODULE_ID, FLAG_EXTERNAL_ID, row.id);
      }
      // Reveal flag — flip on the server if the page-flag disagrees.
      const localRevealed = page.getFlag(MODULE_ID, FLAG_REVEALED_AT);
      if (Boolean(localRevealed) !== Boolean(row.revealed_at)) {
        await this.client.setEntityReveal(campaignId, row.id, Boolean(localRevealed));
      }
      await page.setFlag(MODULE_ID, FLAG_DIRTY, false);
      result.pushed.entities += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        name: page.name,
        message: err.message ?? String(err),
        body: err.body ?? null
      });
    }
  }

  async _pushNotePage(campaignId, page, result) {
    const externalId = page.getFlag(MODULE_ID, FLAG_EXTERNAL_ID);
    const visibility = page.getFlag(MODULE_ID, FLAG_VISIBILITY) ?? "campaign";
    const payload = {
      title: page.name,
      body: page.text?.content ?? "",
      visibility
    };
    try {
      let row;
      if (externalId) {
        row = await this.client.updateNote(campaignId, externalId, payload);
      } else {
        row = await this.client.createNote(campaignId, payload);
        await page.setFlag(MODULE_ID, FLAG_EXTERNAL_ID, row.id);
      }
      await page.setFlag(MODULE_ID, FLAG_DIRTY, false);
      result.pushed.notes += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        name: page.name,
        message: err.message ?? String(err),
        body: err.body ?? null
      });
    }
  }

  async _pushSessionPlan(campaignId, sessionId, result) {
    const journal = game.journal.contents.find(
      (e) => e.getFlag(MODULE_ID, FLAG_KIND) === "session"
    );
    if (!journal) return;

    // Map page name → text content. We treat pages by canonical name rather
    // than by id so a GM accidentally renaming the journal still pushes.
    const byName = new Map();
    for (const p of journal.pages.contents) byName.set(p.name, p);

    const partial = {};
    const gmNotes = byName.get(SESSION_PAGE_GM_NOTES);
    if (gmNotes && gmNotes.getFlag(MODULE_ID, FLAG_DIRTY)) {
      partial.gm_notes = gmNotes.text?.content ?? "";
    }
    const secrets = byName.get(SESSION_PAGE_SECRETS);
    if (secrets && secrets.getFlag(MODULE_ID, FLAG_DIRTY)) {
      // The server returns 403 if the token lacks sessions:secrets — bubble
      // it up so E13 can toast the friendly error.
      partial.gm_secrets = secrets.text?.content ?? "";
    }
    // Agenda / Pinned: round-tripped via structured page flags written by
    // AgendaEditorDialog (GMHUB-161). The rendered HTML is regenerated on
    // both pull and on save in the editor; the flag is the source of truth
    // for push.
    const agendaPage = byName.get(SESSION_PAGE_AGENDA);
    if (agendaPage && agendaPage.getFlag(MODULE_ID, FLAG_DIRTY)) {
      partial.agenda = agendaPage.getFlag(MODULE_ID, FLAG_AGENDA_DATA) ?? [];
    }
    const pinnedPage = byName.get(SESSION_PAGE_PINNED);
    if (pinnedPage && pinnedPage.getFlag(MODULE_ID, FLAG_DIRTY)) {
      partial.pinned = pinnedPage.getFlag(MODULE_ID, FLAG_PINNED_DATA) ?? [];
    }

    if (Object.keys(partial).length === 0) return;

    try {
      await this.client.updateSessionPlan(campaignId, sessionId, partial);
      if (gmNotes) await gmNotes.setFlag(MODULE_ID, FLAG_DIRTY, false);
      if (secrets && partial.gm_secrets !== undefined) {
        await secrets.setFlag(MODULE_ID, FLAG_DIRTY, false);
      }
      if (agendaPage && partial.agenda !== undefined) {
        await agendaPage.setFlag(MODULE_ID, FLAG_DIRTY, false);
      }
      if (pinnedPage && partial.pinned !== undefined) {
        await pinnedPage.setFlag(MODULE_ID, FLAG_DIRTY, false);
      }
      result.pushed.sessionPlan = true;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        name: "session-plan",
        message: err.message ?? String(err),
        body: err.body ?? null
      });
    }
  }

  // Dry-run classification of what pushAll() would do, without making any
  // API calls. Backs the Push preview dialog (GMHUB-160). A page is "create"
  // if it carries no externalId flag, "update" if it has the flag AND is
  // dirty; pages clean of dirty are skipped (existing pushAll behaviour
  // re-uploads them, but the preview classifies by intent so the GM sees
  // only the meaningful diff).
  previewPush() {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) return { error: "no_campaign_bound" };
    const activeSessionId = game.settings.get(MODULE_ID, "activeSessionId");

    const preview = {
      entities: { create: [], update: [] },
      notes: { create: [], update: [] },
      sessionPlan: { gmNotes: false, gmSecrets: false, agenda: false, pinned: false },
      quickNotes: 0,
      total: 0
    };

    for (const kind of Object.keys(KIND_JOURNAL_NAMES)) {
      const journal = game.journal.contents.find(
        (e) => e.getFlag(MODULE_ID, FLAG_KIND) === kind
      );
      if (!journal) continue;
      for (const page of journal.pages.contents) {
        if (page.type !== "text") continue;
        const externalId = page.getFlag(MODULE_ID, FLAG_EXTERNAL_ID);
        const dirty = page.getFlag(MODULE_ID, FLAG_DIRTY);
        if (!externalId) {
          preview.entities.create.push({ name: page.name, kind });
        } else if (dirty) {
          preview.entities.update.push({ name: page.name, kind });
        }
      }
    }

    const notesJournal = game.journal.contents.find(
      (e) => e.getFlag(MODULE_ID, FLAG_KIND) === "notes"
    );
    if (notesJournal) {
      for (const page of notesJournal.pages.contents) {
        if (page.type !== "text") continue;
        const externalId = page.getFlag(MODULE_ID, FLAG_EXTERNAL_ID);
        const dirty = page.getFlag(MODULE_ID, FLAG_DIRTY);
        if (!externalId) {
          preview.notes.create.push({ name: page.name });
        } else if (dirty) {
          preview.notes.update.push({ name: page.name });
        }
      }
    }

    if (activeSessionId) {
      const sessionJournal = game.journal.contents.find(
        (e) => e.getFlag(MODULE_ID, FLAG_KIND) === "session"
      );
      if (sessionJournal) {
        for (const page of sessionJournal.pages.contents) {
          if (!page.getFlag(MODULE_ID, FLAG_DIRTY)) continue;
          if (page.name === SESSION_PAGE_GM_NOTES) preview.sessionPlan.gmNotes = true;
          else if (page.name === SESSION_PAGE_SECRETS) preview.sessionPlan.gmSecrets = true;
          else if (page.name === SESSION_PAGE_AGENDA) preview.sessionPlan.agenda = true;
          else if (page.name === SESSION_PAGE_PINNED) preview.sessionPlan.pinned = true;
        }
      }
    }

    const queue = game.settings.get(MODULE_ID, "pendingPushQueue") ?? [];
    preview.quickNotes = queue.length;

    preview.total =
      preview.entities.create.length + preview.entities.update.length +
      preview.notes.create.length + preview.notes.update.length +
      (preview.sessionPlan.gmNotes ? 1 : 0) +
      (preview.sessionPlan.gmSecrets ? 1 : 0) +
      (preview.sessionPlan.agenda ? 1 : 0) +
      (preview.sessionPlan.pinned ? 1 : 0) +
      preview.quickNotes;

    return preview;
  }

  async pushAll() {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) {
      return { error: "no_campaign_bound" };
    }
    const activeSessionId = game.settings.get(MODULE_ID, "activeSessionId");

    const result = {
      pushed: { entities: 0, notes: 0, sessionPlan: false, quickNotes: 0 },
      failed: 0,
      errors: []
    };

    await this._drainQuickNoteQueue(campaignId, activeSessionId, result);

    // Entities — walk each kind-journal.
    for (const kind of Object.keys(KIND_JOURNAL_NAMES)) {
      const journal = game.journal.contents.find(
        (e) => e.getFlag(MODULE_ID, FLAG_KIND) === kind
      );
      if (!journal) continue;
      for (const page of journal.pages.contents) {
        if (page.type !== "text") {
          console.info(`[gmhub-vtt] skipping non-text page "${page.name}" in ${journal.name}`);
          continue;
        }
        await this._pushEntityPage(campaignId, kind, page, result);
      }
    }

    // Notes — single journal.
    const notesJournal = game.journal.contents.find(
      (e) => e.getFlag(MODULE_ID, FLAG_KIND) === "notes"
    );
    if (notesJournal) {
      for (const page of notesJournal.pages.contents) {
        if (page.type !== "text") {
          console.info(`[gmhub-vtt] skipping non-text note page "${page.name}"`);
          continue;
        }
        await this._pushNotePage(campaignId, page, result);
      }
    }

    // Session plan — only if a session is bound.
    if (activeSessionId) {
      await this._pushSessionPlan(campaignId, activeSessionId, result);
    }

    return result;
  }

  // Push a single JournalEntry (the "Push to GMhub" context-menu action in
  // main.js). Maps to the same per-page upserts pushAll does, scoped to one
  // entry. Entry must carry flags.gmhub-vtt.kind so we know what to do with it.
  async pushOne(entry) {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) throw new Error("no_campaign_bound");
    const kind = entry.getFlag(MODULE_ID, FLAG_KIND);
    const result = {
      pushed: { entities: 0, notes: 0, sessionPlan: false, quickNotes: 0 },
      failed: 0,
      errors: []
    };

    if (kind === "notes") {
      for (const page of entry.pages.contents) {
        if (page.type !== "text") continue;
        await this._pushNotePage(campaignId, page, result);
      }
    } else if (KIND_JOURNAL_NAMES[kind]) {
      for (const page of entry.pages.contents) {
        if (page.type !== "text") continue;
        await this._pushEntityPage(campaignId, kind, page, result);
      }
    } else if (kind === "session") {
      const sessionId = entry.getFlag(MODULE_ID, FLAG_EXTERNAL_ID);
      if (sessionId) await this._pushSessionPlan(campaignId, sessionId, result);
    } else {
      // Unknown / unflagged entry — don't guess.
      throw new Error("entry_not_bound_to_gmhub");
    }
    return result;
  }

  // Back-compat alias for the journal context-menu hook in main.js.
  pushJournal(entry) {
    return this.pushOne(entry);
  }

  // Public helper for the auto-push hook in main.js: just mark the entry as
  // dirty so the next manual Push picks it up. Used when autoPushOnUpdate
  // is OFF (the default per Foundry SCOPE "Manual sync only.").
  async markDirty(entry) {
    await entry.setFlag(MODULE_ID, FLAG_DIRTY, true);
  }

  // Public helper for offline quick-note capture. Pushes to the queue; the
  // next pushAll drains it.
  async enqueueQuickNote(body, mentionedEntityId = null) {
    const queue = game.settings.get(MODULE_ID, "pendingPushQueue") ?? [];
    queue.push({ body, mentioned_entity_id: mentionedEntityId, queued_at: new Date().toISOString() });
    await game.settings.set(MODULE_ID, "pendingPushQueue", queue);
  }
}
