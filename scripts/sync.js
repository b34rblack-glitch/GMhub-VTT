import { MODULE_ID } from "./main.js";

const FLAG_EXTERNAL_ID = "externalId";
const FLAG_PAGE_EXTERNAL_ID = "externalId";

export class SyncService {
  constructor(client) {
    this.client = client;
  }

  _serializePage(page) {
    const externalId = page.getFlag(MODULE_ID, FLAG_PAGE_EXTERNAL_ID) ?? null;
    const base = {
      id: externalId,
      foundryId: page.id,
      name: page.name,
      type: page.type,
      sort: page.sort ?? 0
    };
    if (page.type === "text") {
      base.text = {
        content: page.text?.content ?? "",
        format: page.text?.format ?? CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML
      };
    } else if (page.type === "image") {
      base.src = page.src ?? null;
      base.image = { caption: page.image?.caption ?? "" };
    }
    return base;
  }

  _serializeJournal(entry) {
    return {
      id: entry.getFlag(MODULE_ID, FLAG_EXTERNAL_ID) ?? null,
      foundryId: entry.id,
      name: entry.name,
      folder: entry.folder?.name ?? null,
      pages: entry.pages.contents.map((p) => this._serializePage(p))
    };
  }

  async pushJournal(entry) {
    const payload = this._serializeJournal(entry);
    const remote = payload.id
      ? await this.client.updateJournal(payload.id, payload)
      : await this.client.createJournal(payload);

    if (!remote?.id) return remote;

    if (remote.id !== payload.id) {
      await entry.setFlag(MODULE_ID, FLAG_EXTERNAL_ID, remote.id);
    }

    if (Array.isArray(remote.pages)) {
      const updates = [];
      for (const remotePage of remote.pages) {
        const localPage = entry.pages.get(remotePage.foundryId);
        if (!localPage) continue;
        const currentExternal = localPage.getFlag(MODULE_ID, FLAG_PAGE_EXTERNAL_ID);
        if (remotePage.id && remotePage.id !== currentExternal) {
          updates.push({ _id: localPage.id, [`flags.${MODULE_ID}.${FLAG_PAGE_EXTERNAL_ID}`]: remotePage.id });
        }
      }
      if (updates.length) {
        await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
      }
    }

    return remote;
  }

  async pushAll() {
    const entries = game.journal.contents;
    const results = { pushed: 0, failed: 0, errors: [] };
    for (const entry of entries) {
      try {
        await this.pushJournal(entry);
        results.pushed += 1;
      } catch (err) {
        results.failed += 1;
        results.errors.push({ name: entry.name, message: err.message });
      }
    }
    return results;
  }

  _findLocalByExternalId(externalId) {
    return game.journal.contents.find((e) => e.getFlag(MODULE_ID, FLAG_EXTERNAL_ID) === externalId) ?? null;
  }

  _pageDataFromRemote(remotePage) {
    const data = {
      name: remotePage.name ?? "Untitled",
      type: remotePage.type ?? "text",
      sort: remotePage.sort ?? 0,
      flags: { [MODULE_ID]: { [FLAG_PAGE_EXTERNAL_ID]: remotePage.id } }
    };
    if (data.type === "text") {
      data.text = {
        content: remotePage.text?.content ?? "",
        format: remotePage.text?.format ?? CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML
      };
    } else if (data.type === "image") {
      data.src = remotePage.src ?? null;
      data.image = { caption: remotePage.image?.caption ?? "" };
    }
    return data;
  }

  async pullJournal(remote) {
    const existing = this._findLocalByExternalId(remote.id);
    if (existing) {
      await existing.update({
        name: remote.name,
        flags: { [MODULE_ID]: { [FLAG_EXTERNAL_ID]: remote.id } }
      });
      await this._reconcilePages(existing, remote.pages ?? []);
      return existing;
    }

    const created = await JournalEntry.create({
      name: remote.name ?? "Untitled",
      flags: { [MODULE_ID]: { [FLAG_EXTERNAL_ID]: remote.id } }
    });
    if (remote.pages?.length) {
      await created.createEmbeddedDocuments(
        "JournalEntryPage",
        remote.pages.map((p) => this._pageDataFromRemote(p))
      );
    }
    return created;
  }

  async _reconcilePages(entry, remotePages) {
    const localByExternal = new Map();
    for (const page of entry.pages.contents) {
      const ext = page.getFlag(MODULE_ID, FLAG_PAGE_EXTERNAL_ID);
      if (ext) localByExternal.set(ext, page);
    }

    const toCreate = [];
    const toUpdate = [];
    const remoteIds = new Set();

    for (const remotePage of remotePages) {
      remoteIds.add(remotePage.id);
      const local = localByExternal.get(remotePage.id);
      if (local) {
        toUpdate.push({ _id: local.id, ...this._pageDataFromRemote(remotePage) });
      } else {
        toCreate.push(this._pageDataFromRemote(remotePage));
      }
    }

    const toDelete = [];
    for (const [ext, local] of localByExternal.entries()) {
      if (!remoteIds.has(ext)) toDelete.push(local.id);
    }

    if (toDelete.length) await entry.deleteEmbeddedDocuments("JournalEntryPage", toDelete);
    if (toUpdate.length) await entry.updateEmbeddedDocuments("JournalEntryPage", toUpdate);
    if (toCreate.length) await entry.createEmbeddedDocuments("JournalEntryPage", toCreate);
  }

  async pullAll() {
    const lastPull = game.settings.get(MODULE_ID, "lastPullAt") || null;
    const list = await this.client.listJournals(lastPull ? { updatedSince: lastPull } : {});
    const remotes = Array.isArray(list) ? list : list?.journals ?? [];
    const results = { pulled: 0, failed: 0, errors: [] };

    for (const summary of remotes) {
      try {
        const full = summary.pages ? summary : await this.client.getJournal(summary.id);
        await this.pullJournal(full);
        results.pulled += 1;
      } catch (err) {
        results.failed += 1;
        results.errors.push({ name: summary.name ?? summary.id, message: err.message });
      }
    }

    await game.settings.set(MODULE_ID, "lastPullAt", new Date().toISOString());
    return results;
  }
}
