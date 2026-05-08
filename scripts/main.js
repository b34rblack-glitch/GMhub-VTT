// GMhub VTT Bridge — module entry.
//
// Hook discipline: register all hooks here in init/ready blocks, per
// CLAUDE.md §6. Other files only export classes/functions.

import { GmhubClient } from "./api-client.js";
import { SyncService } from "./sync.js";
import { openAgendaEditorForPage, PickSessionDialog, SyncDialog } from "./ui.js";

export const MODULE_ID = "gmhub-vtt";

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

  // GMHUB-153 (E10) — bind the Foundry world to a single GMhub campaign.
  // Per GMhub-VTT SCOPE: 1 world ↔ 1 campaign, set once. Clearing campaignId
  // also clears activeSessionId so we never sync a stale session pin.
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

  // GMHUB-153 (E10) — set programmatically by the Pick Session dialog.
  game.settings.register(MODULE_ID, "activeSessionId", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // GMHUB-153 (E10) — queue of quick-notes / edits captured during a brief
  // network blip. Per GMhub-VTT SCOPE §Behaviour contracts "Quick notes are
  // queued in Foundry world flags so a brief network blip doesn't lose them."
  // Drained on the next successful Push.
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

  // Pre-load Handlebars templates so opening a dialog doesn't trigger a
  // per-click fetch — the canonical Foundry pattern.
  loadTemplates([
    `modules/${MODULE_ID}/templates/sync-dialog.hbs`,
    `modules/${MODULE_ID}/templates/pick-session.hbs`,
    `modules/${MODULE_ID}/templates/confirm-overwrite.hbs`,
    `modules/${MODULE_ID}/templates/lifecycle-confirm.hbs`,
    `modules/${MODULE_ID}/templates/push-preview.hbs`,
    `modules/${MODULE_ID}/templates/agenda-editor.hbs`
  ]);

  // Register a minimal `eq` helper for the agenda editor's <select> defaults.
  // Module-namespaced via the loose convention of prefixing helper names is
  // unnecessary here — Handlebars helpers are global, but `eq` is a benign,
  // commonly-shared name that other modules also expect to exist.
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
});

// v14 i18n compatibility shim. v0.3.1–0.3.3 surfaced raw `GMHUB.*` keys in
// settings, dialogs, and template-rendered button labels even though
// `lang/en.json` is correctly declared in `module.json` and ships in the
// release zip. v0.3.2/0.3.3 attempted to fix it by manually fetching the
// file and `mergeObject`-ing the expanded form into
// `game.i18n.translations` — that didn't take, presumably because v14 has
// moved the actual lookup target to a private store and the public
// `translations` property no longer round-trips into it.
//
// v0.3.4 stops trying to mutate Foundry's internal store and instead
// patches `game.i18n.localize` and `game.i18n.format` directly. Foundry's
// Handlebars `{{localize}}` / `{{localizeKey}}` helpers call these methods,
// so the override covers templates, settings labels, button text, and
// every direct `game.i18n.localize("...")` call in this module's code.
// The original implementations are still called first; we only fall back
// to our cache when Foundry returns the raw key (its "not found" signal).
Hooks.once("i18nInit", async () => {
  try {
    const res = await fetch(`modules/${MODULE_ID}/lang/en.json`);
    if (!res.ok) {
      console.warn(`[${MODULE_ID}] lang fetch returned ${res.status}`);
      return;
    }
    const flat = await res.json();

    if (game.i18n.localize?.__gmhubPatched) {
      // Defensive: avoid double-patching if i18nInit fires twice (hot reload).
      return;
    }

    const origLocalize = game.i18n.localize.bind(game.i18n);
    const patchedLocalize = function (key) {
      const fromOriginal = origLocalize(key);
      // Foundry's localize returns the raw key when not found.
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

    // Re-render any UI that already painted with raw keys before the patch
    // landed. Settings panel + journal sidebar are the obvious ones; the
    // dialogs render lazily on click so they don't need a kick.
    if (typeof ui !== "undefined") {
      ui.journal?.render?.(false);
      // SettingsConfig is opened on demand; if it's open right now, kick it.
      const settingsApp = Object.values(ui.windows ?? {}).find(
        (w) => w?.constructor?.name === "SettingsConfig"
      );
      settingsApp?.render?.(false);
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

// Foundry v13 changed the renderJournalDirectory hook signature: `html` is
// now a raw HTMLElement, not a jQuery wrapper. The v11/v12 path used
// html.find(...).append(button) which silently no-ops in v13+. Branch on
// type so the same hook works on every supported version.
Hooks.on("renderJournalDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = (html instanceof HTMLElement) ? html : (html?.[0] ?? null);
  if (!root) return;
  // v13+ exposes a .header-actions container holding the "Create Entry" /
  // "Create Folder" buttons; v11/v12 nested it under .directory-header.
  const target = root.querySelector(
    ".directory-header .header-actions, .header-actions, .directory-header"
  );
  if (!target) return;
  if (target.querySelector(".gmhub-sync-button")) return; // re-render guard
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gmhub-sync-button";
  button.innerHTML = `<i class="fas fa-cloud"></i> ${game.i18n.localize("GMHUB.Button.OpenDialog")}`;
  button.addEventListener("click", () => game.modules.get(MODULE_ID).api.openDialog());
  target.appendChild(button);
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
});

// GMHUB-155 (E12). On any GM-driven journal edit, mark the entry dirty so
// the next manual Pull warns + the next manual Push picks it up. Auto-push
// is off by default per GMhub-VTT SCOPE "Manual sync only" — only call
// pushOne when the GM has opted in via the autoPushOnUpdate setting.
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

// GMHUB-161 — surface "Edit Agenda / Edit Pinned" on the page right-click
// context menu inside a session journal's table of contents. The hook fires
// in Foundry v12 when the user right-clicks a page row in the TOC; in
// earlier or later versions where the hook name has shifted, the GM can
// still call game.modules.get("gmhub-vtt").api.openAgendaEditor(page).
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

Hooks.on("updateJournalEntryPage", async (page, _change, _options, userId) => {
  if (game.user.id !== userId) return;
  if (!game.user.isGM) return;
  try {
    await page.setFlag(MODULE_ID, "dirty", true);
  } catch (err) {
    console.warn("[gmhub-vtt] page markDirty failed", err);
  }
});
