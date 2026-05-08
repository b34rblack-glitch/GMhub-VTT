// GMhub VTT Bridge — Pull/Push orchestration (DMHUB-155 / E12).
//
// Maps DMhub content to Foundry's journal model per GMhub-VTT/SCOPE.md
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
// Push overwrites DMhub. No merge, no per-field reconciliation.
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

// Map DMhub four-value visibility → Foundry page-level ownership map.
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

function pinnedHtml(pinned) {
  if (!Array.isArray(pinned) || pinned.length === 0) {
    return "<p><em>No pinned entities.</em></p>";
  }
  const items = pinned
    .map((p) => `<li><strong>${p.entity_type}</strong>: ${p.name}</li>`)
    .join("\n");
  return `<ul>\n${items}\n</ul>`;
}

function agendaHtml(agenda) {
  if (!Array.isArray(agenda) || agenda.length === 0) {
    return "<p><em>No agenda items.</em></p>";
  }
  const items = agenda
    .map((scene) => {
      const dur = scene.estimated_duration_min
        ? ` <em>(${scene.estimated_duration_min}m)</em>`
        : "";
      const notes = scene.notes ? `<p>${scene.notes}</p>` : "";
      return `<li><strong>${scene.title ?? "(untitled)"}</strong>${dur}${notes}</li>`;
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
      text: { content: entity.summary ?? "", format: 1 /* HTML */ },
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
      text: { content: note.body ?? "", format: 1 },
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
          text: { content: plan.gm_notes ?? "", format: 1 },
          ownership: gmOnly,
          flags: { [MODULE_ID]: { [FLAG_EXTERNAL_ID]: `${activeSessionId}:gm_notes`, [FLAG_DIRTY]: false } }
        });
        await this._upsertPage(journal, `${activeSessionId}:agenda`, {
          name: SESSION_PAGE_AGENDA,
          type: "text",
          text: { content: agendaHtml(plan.agenda), format: 1 },
          ownership: gmOnly,
          flags: { [MODULE_ID]: { [FLAG_EXTERNAL_ID]: `${activeSessionId}:agenda`, [FLAG_DIRTY]: false } }
        });
        // GM Secrets is included only when the token's scope permitted it
        // (the server omits the field otherwise — absence is the signal).
        if (Object.prototype.hasOwnProperty.call(plan, "gm_secrets")) {
          await this._upsertPage(journal, `${activeSessionId}:gm_secrets`, {
            name: SESSION_PAGE_SECRETS,
            type: "text",
            text: { content: plan.gm_secrets ?? "", format: 1 },
            ownership: gmOnly, // GM-only forever — page-level invariant.
            flags: { [MODULE_ID]: { [FLAG_EXTERNAL_ID]: `${activeSessionId}:gm_secrets`, [FLAG_DIRTY]: false } }
          });
        }
        await this._upsertPage(journal, `${activeSessionId}:pinned`, {
          name: SESSION_PAGE_PINNED,
          type: "text",
          text: { content: pinnedHtml(plan.pinned), format: 1 },
          ownership: gmOnly,
          flags: { [MODULE_ID]: { [FLAG_EXTERNAL_ID]: `${activeSessionId}:pinned`, [FLAG_DIRTY]: false } }
        });
        result.pulled.sessionPlan = true;
      } catch (err) {
        result.errors.push({ name: "session-plan", message: err.message ?? String(err) });
      }
    }

    await game.settings.set(MODULE_ID, "lastPullAt", new Date().toISOString());
    return result;
  }

  // ---- Push (stubbed in this commit; lands in DMHUB-155 follow-up) ----

  async pushAll() {
    throw new Error("pushAll not implemented yet — see DMHUB-155 follow-up.");
  }

  async pushOne(_entry) {
    throw new Error("pushOne not implemented yet — see DMHUB-155 follow-up.");
  }

  async pushJournal(_entry) {
    throw new Error("pushJournal not implemented yet — see DMHUB-155 follow-up.");
  }
}
