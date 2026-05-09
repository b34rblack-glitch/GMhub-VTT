// GMhub VTT Bridge — module entry.
//
// Hook discipline: register all hooks here in init/ready blocks, per
// CLAUDE.md §6. Other files only export classes/functions.

import { GmhubClient } from "./api-client.js";
import { SyncService } from "./sync.js";
import { openAgendaEditorForPage, PickSessionDialog, SyncDialog } from "./ui.js";

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
    scope: "world",
    config: true,
    type: String,
    default: "https://gmhub.app"
  });

  game.settings.register(MODULE_ID, "apiKey", {
    name: "GMHUB.Settings.ApiKey.Name",
    hint: "GMHUB.Settings.ApiKey.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "campaignId", {
    name: "GMHUB.Settings.CampaignId.Name",
    hint: "GMHUB.Settings.CampaignId.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: (value) => {
      const current = game.settings.get(MODULE_ID, "activeSessionId");
      if (!value && current) {
        game.settings.set(MODULE_ID, "activeSessionId", "");
      }
    }
  });

  game.settings.register(MODULE_ID, "activeSessionId", {
    scope: "world",
    config: false,
    type: String,
    default: "",
    onChange: () => _refreshActiveSessionUI()
  });

  game.settings.register(MODULE_ID, "pendingPushQueue", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, "autoPushOnUpdate", {
    name: "GMHUB.Settings.AutoPush.Name",
    hint: "GMHUB.Settings.AutoPush.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "lastPullAt", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  loadTemplates([
    `modules/${MODULE_ID}/templates/sync-dialog.hbs`,
    `modules/${MODULE_ID}/templates/pick-session.hbs`,
    `modules/${MODULE_ID}/templates/confirm-overwrite.hbs`,
    `modules/${MODULE_ID}/templates/lifecycle-confirm.hbs`,
    `modules/${MODULE_ID}/templates/push-preview.hbs`,
    `modules/${MODULE_ID}/templates/agenda-editor.hbs`
  ]);

  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
});

// v14 i18n compatibility shim — see CLAUDE.md §4 (v0.3.4) for the trail.
//
// v0.4.1 follow-up: also re-register Handlebars `localize` and
// `localizeFormat` helpers AFTER patching the underlying methods.
// In v14 Foundry registers those helpers with a bound reference to the
// original `game.i18n.localize` / `game.i18n.format` captured before our
// patch runs, so direct JS calls to `game.i18n.localize` go through our
// flat-cache fallback ("Pull complete" renders) but `{{localize}}` in
// `.hbs` templates still dispatches to the un-patched original (dialog
// labels render as raw `GMHUB.Dialog.*` keys). Re-registering the helpers
// with closures over the live `game.i18n.*` methods routes Handlebars
// through the patched path on every render.
Hooks.once("i18nInit", async () => {
  try {
    const res = await fetch(`modules/${MODULE_ID}/lang/en.json`);
    if (!res.ok) {
      console.warn(`[${MODULE_ID}] lang fetch returned ${res.status}`);
      return;
    }
    const flat = await res.json();

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

    // Re-register the Handlebars helpers so `{{localize}}` in templates
    // dispatches through the patched localize / format on every render.
    // Foundry's earlier registration captures a bound original; without
    // this re-register the patch only takes effect for direct JS calls.
    Handlebars.registerHelper("localize", function (key) {
      return game.i18n.localize(key);
    });
    Handlebars.registerHelper("localizeFormat", function (key, options) {
      const data = (options && options.hash) ? options.hash : {};
      return game.i18n.format(key, data);
    });

    if (typeof ui !== "undefined") {
      ui.journal?.render?.(false);
      const settingsApp = Object.values(ui.windows ?? {}).find(
        (w) => w?.constructor?.name === "SettingsConfig"
      );
      settingsApp?.render?.(false);
      // Also kick any open SyncDialog so its Handlebars-rendered body
      // picks up the now-correctly-localized labels without a manual
      // close/reopen.
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
    openAgendaEditor: (page) => openAgendaEditorForPage(page)
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
      (e) =>
        e.getFlag(MODULE_ID, "kind") === "session" &&
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
      ui.notifications.info(
        game.i18n.format("GMHUB.Notify.SessionBound", { name: entry.name })
      );
    }
  });
});

Hooks.on("updateJournalEntry", async (entry, _change, _options, userId) => {
  if (game.user.id !== userId) return;
  if (!game.user.isGM) return;
  const { sync } = game.modules.get(MODULE_ID).api;
  try {
    await sync.markDirty(entry);
  } catch (err) {
    console.warn("[gmhub-vtt] markDirty failed", err);
  }
  if (!game.settings.get(MODULE_ID, "autoPushOnUpdate")) return;
  try {
    await sync.pushOne(entry);
  } catch (err) {
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
});

Hooks.on("updateJournalEntryPage", async (page, change, _options, userId) => {
  if (game.user.id !== userId) return;
  if (!game.user.isGM) return;

  const parentKind = page.parent?.getFlag(MODULE_ID, "kind");
  if (!parentKind) return;

  if (change.ownership && parentKind !== "session") {
    const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    const newVisibility = page.ownership?.default === NONE ? "gm_only" : "campaign";
    const currentVisibility = page.getFlag(MODULE_ID, "visibility");
    if (currentVisibility !== newVisibility) {
      try {
        await page.setFlag(MODULE_ID, "visibility", newVisibility);
      } catch (err) {
        console.warn("[gmhub-vtt] visibility map failed", err);
      }
    }
  }

  const isUserChange =
    change.text !== undefined ||
    change.ownership !== undefined ||
    change.name !== undefined;
  if (!isUserChange) return;

  try {
    await page.setFlag(MODULE_ID, "dirty", true);
  } catch (err) {
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
