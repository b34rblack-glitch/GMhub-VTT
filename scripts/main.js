// GMhub VTT Bridge — module entry.
//
// 0016 (Unified Visibility): the per-page eye-toggle reverse-mapper in
// updateJournalEntryPage is gone. The VisibilityDialog (context-menu
// entry on every synced note page) is the canonical way to change
// visibility/recipients now; Foundry's native eye toggle still works
// locally but won't be pushed back to GMhub.

import { GmhubClient } from "./api-client.js";
import { SyncService } from "./sync.js";
import {
  openAgendaEditorForPage,
  openVisibilityDialogForPage,
  PickSessionDialog,
  PlayerMapDialog,
  SyncDialog
} from "./ui.js";

export const MODULE_ID = "gmhub-vtt";

function _refreshActiveSessionUI() {
  if (typeof ui === "undefined") return;
  ui.journal?.render?.(false);
  for (const win of Object.values(ui.windows ?? {})) {
    if (win?.constructor?.name === "SyncDialog") win.render?.(false);
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "baseUrl", {
    name: "GMHUB.Settings.BaseUrl.Name",
    hint: "GMHUB.Settings.BaseUrl.Hint",
    scope: "world", config: true, type: String,
    default: "https://gmhub.app"
  });
  game.settings.register(MODULE_ID, "apiKey", {
    name: "GMHUB.Settings.ApiKey.Name",
    hint: "GMHUB.Settings.ApiKey.Hint",
    scope: "world", config: true, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "campaignId", {
    name: "GMHUB.Settings.CampaignId.Name",
    hint: "GMHUB.Settings.CampaignId.Hint",
    scope: "world", config: true, type: String, default: "",
    onChange: (value) => {
      const current = game.settings.get(MODULE_ID, "activeSessionId");
      if (!value && current) game.settings.set(MODULE_ID, "activeSessionId", "");
    }
  });
  game.settings.register(MODULE_ID, "activeSessionId", {
    scope: "world", config: false, type: String, default: "",
    onChange: () => _refreshActiveSessionUI()
  });
  game.settings.register(MODULE_ID, "pendingPushQueue", {
    scope: "world", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "autoPushOnUpdate", {
    name: "GMHUB.Settings.AutoPush.Name",
    hint: "GMHUB.Settings.AutoPush.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "lastPullAt", {
    scope: "world", config: false, type: String, default: ""
  });
  // 0016 (Unified Visibility) — GM-managed map from GMhub user id to
  // Foundry user id. The `shared` visibility path needs this to apply
  // per-user JournalEntryPage.ownership; without a mapping the GM
  // sees a one-time warning at Pull time.
  game.settings.register(MODULE_ID, "playerMap", {
    scope: "world", config: false, type: Object, default: {}
  });
  game.settings.registerMenu(MODULE_ID, "playerMapMenu", {
    name: "GMHUB.Settings.Mapping.Menu.Name",
    label: "GMHUB.Settings.Mapping.Menu.Label",
    hint: "GMHUB.Settings.Mapping.Menu.Hint",
    icon: "fas fa-users-cog",
    type: PlayerMapDialog,
    restricted: true
  });

  loadTemplates([
    `modules/${MODULE_ID}/templates/sync-dialog.hbs`,
    `modules/${MODULE_ID}/templates/pick-session.hbs`,
    `modules/${MODULE_ID}/templates/confirm-overwrite.hbs`,
    `modules/${MODULE_ID}/templates/lifecycle-confirm.hbs`,
    `modules/${MODULE_ID}/templates/push-preview.hbs`,
    `modules/${MODULE_ID}/templates/agenda-editor.hbs`,
    `modules/${MODULE_ID}/templates/player-map.hbs`,
    `modules/${MODULE_ID}/templates/visibility.hbs`
  ]);

  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
});

Hooks.once("i18nInit", async () => {
  try {
    const res = await fetch(`modules/${MODULE_ID}/lang/en.json`);
    if (!res.ok) {
      console.warn(`[${MODULE_ID}] lang fetch returned ${res.status}`);
      return;
    }
    const flat = await res.json();
    try {
      const expanded = foundry.utils.expandObject(flat);
      foundry.utils.mergeObject(game.i18n.translations, expanded, {
        inplace: true, overwrite: false
      });
    } catch (mergeErr) {
      console.warn(`[${MODULE_ID}] translations merge failed`, mergeErr);
    }
    for (const [key, value] of Object.entries(flat)) {
      try { foundry.utils.setProperty(game.i18n.translations, key, value); } catch {}
    }
    if (!game.i18n.localize?.__gmhubPatched) {
      const origLocalize = game.i18n.localize.bind(game.i18n);
      const patchedLocalize = function (key) {
        const fromOriginal = origLocalize(key);
        if (fromOriginal !== key) return fromOriginal;
        return Object.prototype.hasOwnProperty.call(flat, key) ? flat[key] : key;
      };
      patchedLocalize.__gmhubPatched = true;
      game.i18n.localize = patchedLocalize;
      const origFormat = game.i18n.format.bind(game.i18n);
      const patchedFormat = function (key, data) {
        const fromOriginal = origFormat(key, data);
        if (fromOriginal !== key) return fromOriginal;
        const template = flat[key];
        if (typeof template !== "string") return key;
        return template.replace(/\{(\w+)\}/g, (_, k) =>
          data && Object.prototype.hasOwnProperty.call(data, k) ? String(data[k]) : `{${k}}`
        );
      };
      patchedFormat.__gmhubPatched = true;
      game.i18n.format = patchedFormat;
    }
    if (typeof ui !== "undefined") {
      ui.journal?.render?.(false);
      const settingsApp = Object.values(ui.windows ?? {}).find(
        (w) => w?.constructor?.name === "SettingsConfig"
      );
      settingsApp?.render?.(false);
      for (const win of Object.values(ui.windows ?? {})) {
        if (win?.constructor?.name === "SyncDialog") win.render?.(false);
      }
    }
  } catch (err) {
    console.warn(`[${MODULE_ID}] manual lang load failed`, err);
  }
});

Hooks.once("ready", () => {
  const client = new GmhubClient({
    getBaseUrl: () => game.settings.get(MODULE_ID, "baseUrl"),
    getApiKey: () => game.settings.get(MODULE_ID, "apiKey")
  });
  const sync = new SyncService(client);
  game.modules.get(MODULE_ID).api = {
    client,
    sync,
    openDialog: () => new SyncDialog(sync).render(true),
    openPickSession: () => new PickSessionDialog(client).render(true),
    openAgendaEditor: (page) => openAgendaEditorForPage(page),
    openPlayerMap: () => new PlayerMapDialog().render(true),
    openVisibilityDialog: (page) => openVisibilityDialogForPage(page, client)
  };
});

Hooks.on("renderJournalDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = (html instanceof HTMLElement) ? html : (html?.[0] ?? null);
  if (!root) return;
  const target = root.querySelector(
    ".directory-header .header-actions, .header-actions, .directory-header"
  );
  if (target && !target.querySelector(".gmhub-sync-button")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gmhub-sync-button";
    button.innerHTML = `<i class="fas fa-cloud"></i> ${game.i18n.localize("GMHUB.Button.OpenDialog")}`;
    button.addEventListener("click", () => game.modules.get(MODULE_ID).api.openDialog());
    target.appendChild(button);
  }
  const activeSessionId = game.settings.get(MODULE_ID, "activeSessionId");
  for (const el of root.querySelectorAll(".gmhub-active-session")) {
    el.classList.remove("gmhub-active-session");
  }
  if (activeSessionId) {
    const activeJournal = game.journal.contents.find(
      (e) => e.getFlag(MODULE_ID, "kind") === "session" &&
             e.getFlag(MODULE_ID, "externalId") === activeSessionId
    );
    if (activeJournal) {
      const li = root.querySelector(
        `[data-document-id="${activeJournal.id}"], [data-entry-id="${activeJournal.id}"]`
      );
      li?.classList.add("gmhub-active-session");
    }
  }
});

Hooks.on("getJournalEntryContextOptions", (html, options) => {
  if (!game.user.isGM) return;
  options.push({
    name: "GMHUB.Context.PushOne",
    icon: '<i class="fas fa-cloud-upload-alt"></i>',
    callback: async (li) => {
      const entry = game.journal.get(li.data("documentId") ?? li.data("entryId"));
      if (!entry) return;
      const { sync } = game.modules.get(MODULE_ID).api;
      await sync.pushJournal(entry);
      ui.notifications.info(game.i18n.format("GMHUB.Notify.Pushed", { name: entry.name }));
    }
  });
  options.push({
    name: "GMHUB.Context.SetActiveSession",
    icon: '<i class="fas fa-play-circle"></i>',
    condition: (li) => {
      const entryId = li?.data?.("documentId") ?? li?.data?.("entryId");
      const entry = game.journal.get(entryId);
      if (!entry) return false;
      if (entry.getFlag(MODULE_ID, "kind") !== "session") return false;
      const sessionId = entry.getFlag(MODULE_ID, "externalId");
      if (!sessionId) return false;
      return sessionId !== game.settings.get(MODULE_ID, "activeSessionId");
    },
    callback: async (li) => {
      const entryId = li?.data?.("documentId") ?? li?.data?.("entryId");
      const entry = game.journal.get(entryId);
      if (!entry) return;
      const sessionId = entry.getFlag(MODULE_ID, "externalId");
      if (!sessionId) return;
      await game.settings.set(MODULE_ID, "activeSessionId", sessionId);
      ui.notifications.info(game.i18n.format("GMHUB.Notify.SessionBound", { name: entry.name }));
    }
  });
});

Hooks.on("updateJournalEntry", async (entry, _change, _options, userId) => {
  if (game.user.id !== userId) return;
  if (!game.user.isGM) return;
  const { sync } = game.modules.get(MODULE_ID).api;
  try { await sync.markDirty(entry); } catch (err) {
    console.warn("[gmhub-vtt] markDirty failed", err);
  }
  if (!game.settings.get(MODULE_ID, "autoPushOnUpdate")) return;
  try { await sync.pushOne(entry); } catch (err) {
    console.error("[gmhub-vtt] auto-push failed", err);
  }
});

Hooks.on("getJournalEntryPageContextOptions", (app, options) => {
  if (!game.user.isGM) return;
  options.push({
    name: "GMHUB.Context.EditAgenda",
    icon: '<i class="fas fa-list-ol"></i>',
    condition: (li) => {
      const pageId = li?.data?.("page-id") ?? li?.data?.("pageId");
      const page = app?.object?.pages?.get?.(pageId);
      if (!page) return false;
      if (page.parent?.getFlag(MODULE_ID, "kind") !== "session") return false;
      return page.name === "Agenda" || page.name === "Pinned";
    },
    callback: (li) => {
      const pageId = li?.data?.("page-id") ?? li?.data?.("pageId");
      const page = app?.object?.pages?.get?.(pageId);
      openAgendaEditorForPage(page);
    }
  });
  // 0016 (Unified Visibility): one context entry per synced page. The
  // dialog handles notes today and can be extended to entities/sessions
  // by relaxing the condition below.
  options.push({
    name: "GMHUB.Context.EditVisibility",
    icon: '<i class="fas fa-user-shield"></i>',
    condition: (li) => {
      const pageId = li?.data?.("page-id") ?? li?.data?.("pageId");
      const page = app?.object?.pages?.get?.(pageId);
      if (!page) return false;
      if (page.parent?.getFlag(MODULE_ID, "kind") !== "notes") return false;
      return Boolean(page.getFlag(MODULE_ID, "externalId"));
    },
    callback: (li) => {
      const pageId = li?.data?.("page-id") ?? li?.data?.("pageId");
      const page = app?.object?.pages?.get?.(pageId);
      const { client } = game.modules.get(MODULE_ID).api;
      openVisibilityDialogForPage(page, client);
    }
  });
});

Hooks.on("updateJournalEntryPage", async (page, change, _options, userId) => {
  if (game.user.id !== userId) return;
  if (!game.user.isGM) return;
  const parentKind = page.parent?.getFlag(MODULE_ID, "kind");
  if (!parentKind) return;

  const isUserChange =
    change.text !== undefined ||
    change.ownership !== undefined ||
    change.name !== undefined;
  if (!isUserChange) return;

  try { await page.setFlag(MODULE_ID, "dirty", true); } catch (err) {
    console.warn("[gmhub-vtt] page markDirty failed", err);
  }
  if (!game.settings.get(MODULE_ID, "autoPushOnUpdate")) return;
  try {
    const { sync } = game.modules.get(MODULE_ID).api;
    await sync.pushOne(page.parent);
  } catch (err) {
    console.error("[gmhub-vtt] auto-push (page) failed", err);
  }
});
