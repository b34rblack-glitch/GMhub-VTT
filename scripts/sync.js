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
//   sessions (windowed, v0.4.0)
//     → prep + most-recent ended + running session each become their own
//        JournalEntry under the auto-created "GMhub Sessions" folder, with
//        the same four pages (GM Notes, Agenda, GM Secrets, Pinned).
//
// Conflict policy is direction-wins (per SCOPE): Pull overwrites Foundry,
// Push overwrites GMhub. Session orphans (journals outside the new pull
// window) are deleted, unless they carry unpushed dirty edits — those are
// skipped with a warning toast so the GM can resolve before next Pull.
//
// v0.4.0-δ fans Push out across all session journals: editing a prep
// session's GM Notes / Agenda / Pinned in Foundry pushes back to that
// session, not just the active one.
//
// Stable IDs travel via flags.gmhub-vtt.externalId on every synced page
// AND every session JournalEntry. Re-syncs key off the flag; we never look
// up by name.

import { MODULE_ID } from "./main.js";

const FLAG_KIND = "kind"; // "npc" | "location" | … | "notes" | "session"
const FLAG_EXTERNAL_ID = "externalId";
const FLAG_VISIBILITY = "visibility";
const FLAG_REVEALED_AT = "revealedAt";
const FLAG_DIRTY = "dirty";
const FLAG_ENTITY_TYPE = "entityType";
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
const SESSION_FOLDER_NAME = "GMhub Sessions";

const SESSION_PAGE_GM_NOTES = "GM Notes";
const SESSION_PAGE_AGENDA = "Agenda";
const SESSION_PAGE_SECRETS = "GM Secrets";
const SESSION_PAGE_PINNED = "Pinned";

// Compute the session pull window per SCOPE § Content types pulled:
//   - all sessions in `prep` state (no started_at)
//   - the single most-recently-ended session (largest ended_at)
//   - the running session if any (started_at && !ended_at)
function computeSessionWindow(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const prep = list.filter((s) => s && !s.started_at && !s.ended_at);
  const running = list.find((s) => s && s.started_at && !s.ended_at);
  const ended = list
    .filter((s) => s && s.ended_at)
    .sort((a, b) => {
      const ta = a.ended_at ? new Date(a.ended_at).getTime() : 0;
      const tb = b.ended_at ? new Date(b.ended_at).getTime() : 0;
      return tb - ta;
    });
  const lastRecap = ended[0] ?? null;

  const byId = new Map();
  for (const s of prep) if (s?.id) byId.set(s.id, s);
  if (running?.id) byId.set(running.id, running);
  if (lastRecap?.id) byId.set(lastRecap.id, lastRecap);
  return Array.from(byId.values());
}

function sessionJournalName(session) {
  const ts = session?.created_at;
  let datePart = "????-??-??";
  if (typeof ts === "string" && ts.length >= 10) {
    datePart = ts.slice(0, 10);
  }
  const title = session?.title ?? "(untitled)";
  return `${datePart} — ${title}`;
}

async function ensureSessionFolder() {
  const existing = game.folders?.find?.(
    (f) => f?.type === "JournalEntry" && f?.name === SESSION_FOLDER_NAME
  );
  if (existing) return existing;
  return Folder.create({
    name: SESSION_FOLDER_NAME,
    type: "JournalEntry",
    color: "#6366f1"
  });
}

// ---- Tiptap ProseMirror-JSON → HTML ------------------------------------

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
      const label = _escapeHtml(node.attrs?.label ?? node.attrs?.id ?? "");
      const entityType = _escapeHtml(node.attrs?.entityType ?? "");
      const id = _escapeHtml(node.attrs?.id ?? "");
      return `<span class="gmhub-mention" data-entity-type="${entityType}" data-entity-id="${id}">@${label}</span>`;
    }
    default:
      return kids;
  }
}

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

function ownershipLevels() {
  return {
    NONE: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
    OBSERVER: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
    OWNER: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
  };
}

function gmUserId() {
  return game.users.find((u) => u.isGM)?.id ?? game.user.id;
}

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

  _findSessionJournal(sessionId) {
    if (!sessionId) return null;
    return (
      game.journal.contents.find(
        (e) =>
          e.getFlag(MODULE_ID, FLAG_KIND) === "session" &&
          e.getFlag(MODULE_ID, FLAG_EXTERNAL_ID) === sessionId
      ) ?? null
    );
  }

  _allSessionJournals() {
    return game.journal.contents.filter(
      (e) => e.getFlag(MODULE_ID, FLAG_KIND) === "session"
    );
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

  async _upsertSessionJournal(session, plan, folder) {
    const sessionId = session?.id;
    if (!sessionId) return null;
    const newName = sessionJournalName(session);
    const folderId = folder?.id ?? null;

    let journal = this._findSessionJournal(sessionId);
    if (!journal) {
      journal = await JournalEntry.create({
        name: newName,
        folder: folderId,
        flags: {
          [MODULE_ID]: {
            [FLAG_KIND]: "session",
            [FLAG_EXTERNAL_ID]: sessionId
          }
        }
      });
    } else {
      const updates = {};
      if (journal.name !== newName) updates.name = newName;
      if (folderId && journal.folder?.id !== folderId) updates.folder = folderId;
      if (Object.keys(updates).length) await journal.update(updates);
    }

    const { NONE, OWNER } = ownershipLevels();
    const gmOnly = { default: NONE, [gmUserId()]: OWNER };

    await this._upsertPage(journal, `${sessionId}:gm_notes`, {
      name: SESSION_PAGE_GM_NOTES,
      type: "text",
      text: { content: tiptapToHtml(plan?.gm_notes), format: 1 },
      ownership: gmOnly,
      flags: {
        [MODULE_ID]: {
          [FLAG_EXTERNAL_ID]: `${sessionId}:gm_notes`,
          [FLAG_DIRTY]: false
        }
      }
    });
    await this._upsertPage(journal, `${sessionId}:agenda`, {
      name: SESSION_PAGE_AGENDA,
      type: "text",
      text: { content: agendaHtml(plan?.agenda), format: 1 },
      ownership: gmOnly,
      flags: {
        [MODULE_ID]: {
          [FLAG_EXTERNAL_ID]: `${sessionId}:agenda`,
          [FLAG_DIRTY]: false,
          [FLAG_AGENDA_DATA]: Array.isArray(plan?.agenda) ? plan.agenda : []
        }
      }
    });
    if (plan && Object.prototype.hasOwnProperty.call(plan, "gm_secrets")) {
      await this._upsertPage(journal, `${sessionId}:gm_secrets`, {
        name: SESSION_PAGE_SECRETS,
        type: "text",
        text: { content: tiptapToHtml(plan.gm_secrets), format: 1 },
        ownership: gmOnly,
        flags: {
          [MODULE_ID]: {
            [FLAG_EXTERNAL_ID]: `${sessionId}:gm_secrets`,
            [FLAG_DIRTY]: false
          }
        }
      });
    }
    await this._upsertPage(journal, `${sessionId}:pinned`, {
      name: SESSION_PAGE_PINNED,
      type: "text",
      text: { content: pinnedHtml(plan?.pinned), format: 1 },
      ownership: gmOnly,
      flags: {
        [MODULE_ID]: {
          [FLAG_EXTERNAL_ID]: `${sessionId}:pinned`,
          [FLAG_DIRTY]: false,
          [FLAG_PINNED_DATA]: Array.isArray(plan?.pinned) ? plan.pinned : []
        }
      }
    });

    return journal;
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

    const dirty = this._findDirtyEntries();
    if (dirty.length && typeof confirmOverwrite === "function") {
      const confirmed = await confirmOverwrite(dirty);
      if (!confirmed) return { cancelled: true };
    }

    const result = {
      pulled: { entities: 0, notes: 0, sessions: 0 },
      errors: []
    };

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

    let pulledSessionIds = new Set();
    try {
      const sessionsList = await this.client.listSessions(campaignId);
      const window = computeSessionWindow(sessionsList ?? []);
      const folder = window.length > 0 ? await ensureSessionFolder() : null;

      for (const session of window) {
        try {
          const plan = await this.client.getSessionPlan(campaignId, session.id);
          await this._upsertSessionJournal(session, plan, folder);
          pulledSessionIds.add(session.id);
          result.pulled.sessions += 1;
        } catch (err) {
          result.errors.push({
            name: `session ${sessionJournalName(session)}`,
            message: err.message ?? String(err)
          });
        }
      }
    } catch (err) {
      result.errors.push({ name: "sessions-list", message: err.message ?? String(err) });
    }

    const orphans = this._allSessionJournals().filter(
      (e) => !pulledSessionIds.has(e.getFlag(MODULE_ID, FLAG_EXTERNAL_ID))
    );
    const skippedDirty = [];
    for (const orphan of orphans) {
      const dirtyEntry = orphan.getFlag(MODULE_ID, FLAG_DIRTY);
      const dirtyPage = orphan.pages.contents.some((p) => p.getFlag(MODULE_ID, FLAG_DIRTY));
      if (dirtyEntry || dirtyPage) {
        skippedDirty.push(orphan.name);
        continue;
      }
      try {
        await orphan.delete();
      } catch (err) {
        result.errors.push({
          name: `orphan ${orphan.name}`,
          message: err.message ?? String(err)
        });
      }
    }
    if (skippedDirty.length) {
      ui.notifications?.warn(
        `[gmhub-vtt] Skipped ${skippedDirty.length} stale session journal(s) with unpushed edits: ${skippedDirty.join(
          ", "
        )}. Push or delete manually before next Pull.`
      );
    }

    await game.settings.set(MODULE_ID, "lastPullAt", new Date().toISOString());
    return result;
  }

  // ---- Push ----

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
        await page.setFlag(MODULE_ID, FLAG_EXTERNAL_ID, row.id);
      }
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

  // Push the dirty session-plan pages of one specific session journal.
  // Looks up by externalId so multi-session worlds route correctly.
  // result.pushed.sessionPlans accumulates across all session pushes
  // performed in one pushAll call (was a boolean pre-0.4.0-δ).
  async _pushSessionPlan(campaignId, sessionId, result) {
    const journal = this._findSessionJournal(sessionId);
    if (!journal) return;

    const byName = new Map();
    for (const p of journal.pages.contents) byName.set(p.name, p);

    const partial = {};
    const gmNotes = byName.get(SESSION_PAGE_GM_NOTES);
    if (gmNotes && gmNotes.getFlag(MODULE_ID, FLAG_DIRTY)) {
      partial.gm_notes = gmNotes.text?.content ?? "";
    }
    const secrets = byName.get(SESSION_PAGE_SECRETS);
    if (secrets && secrets.getFlag(MODULE_ID, FLAG_DIRTY)) {
      partial.gm_secrets = secrets.text?.content ?? "";
    }
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
      result.pushed.sessionPlans += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        name: `session-plan ${journal.name}`,
        message: err.message ?? String(err),
        body: err.body ?? null
      });
    }
  }

  previewPush() {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) return { error: "no_campaign_bound" };

    const preview = {
      entities: { create: [], update: [] },
      notes: { create: [], update: [] },
      // Aggregated booleans across all session journals — "at least one
      // session has a dirty page of this kind". Per-session breakdown
      // surfaces in `sessionPlanJournals` for future template enhancement.
      sessionPlan: { gmNotes: false, gmSecrets: false, agenda: false, pinned: false },
      sessionPlanJournals: [],
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

    // 0.4.0-δ: walk all session journals, not just the active one. The
    // PushPreviewDialog template still consumes the aggregated booleans
    // (sessionPlan.gmNotes etc.) so existing UI keeps working. Per-session
    // breakdown lives in sessionPlanJournals for future surfacing.
    for (const journal of this._allSessionJournals()) {
      let anyDirty = false;
      for (const page of journal.pages.contents) {
        if (!page.getFlag(MODULE_ID, FLAG_DIRTY)) continue;
        anyDirty = true;
        if (page.name === SESSION_PAGE_GM_NOTES) preview.sessionPlan.gmNotes = true;
        else if (page.name === SESSION_PAGE_SECRETS) preview.sessionPlan.gmSecrets = true;
        else if (page.name === SESSION_PAGE_AGENDA) preview.sessionPlan.agenda = true;
        else if (page.name === SESSION_PAGE_PINNED) preview.sessionPlan.pinned = true;
      }
      if (anyDirty) preview.sessionPlanJournals.push(journal.name);
    }

    const queue = game.settings.get(MODULE_ID, "pendingPushQueue") ?? [];
    preview.quickNotes = queue.length;

    preview.total =
      preview.entities.create.length + preview.entities.update.length +
      preview.notes.create.length + preview.notes.update.length +
      preview.sessionPlanJournals.length +
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
      pushed: { entities: 0, notes: 0, sessionPlans: 0, quickNotes: 0 },
      failed: 0,
      errors: []
    };

    // Quick notes always attach to the active session per SCOPE § Quick
    // notes; this is independent of the multi-session push fan-out.
    await this._drainQuickNoteQueue(campaignId, activeSessionId, result);

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

    // 0.4.0-δ: push fans out across every session journal that has at
    // least one dirty page. Each journal's externalId routes to its own
    // session on the server, so prep edits, recap edits, and live-session
    // edits all round-trip in a single Push.
    for (const journal of this._allSessionJournals()) {
      const sessionId = journal.getFlag(MODULE_ID, FLAG_EXTERNAL_ID);
      if (!sessionId) continue;
      const hasDirty = journal.pages.contents.some((p) => p.getFlag(MODULE_ID, FLAG_DIRTY));
      if (!hasDirty) continue;
      await this._pushSessionPlan(campaignId, sessionId, result);
    }

    return result;
  }

  async pushOne(entry) {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) throw new Error("no_campaign_bound");
    const kind = entry.getFlag(MODULE_ID, FLAG_KIND);
    const result = {
      pushed: { entities: 0, notes: 0, sessionPlans: 0, quickNotes: 0 },
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
      throw new Error("entry_not_bound_to_gmhub");
    }
    return result;
  }

  pushJournal(entry) {
    return this.pushOne(entry);
  }

  async markDirty(entry) {
    await entry.setFlag(MODULE_ID, FLAG_DIRTY, true);
  }

  async enqueueQuickNote(body, mentionedEntityId = null) {
    const queue = game.settings.get(MODULE_ID, "pendingPushQueue") ?? [];
    queue.push({ body, mentioned_entity_id: mentionedEntityId, queued_at: new Date().toISOString() });
    await game.settings.set(MODULE_ID, "pendingPushQueue", queue);
  }
}
