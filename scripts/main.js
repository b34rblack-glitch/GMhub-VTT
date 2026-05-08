// GMhub VTT Bridge — module entry.
//
// Hook discipline: register all hooks here in init/ready blocks, per
// CLAUDE.md §6. Other files only export classes/functions.

import { GMhubClient } from "./api-client.js";
import { SyncService } from "./sync.js";
import { PickSessionDialog, SyncDialog } from "./ui.js";

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

  // DMHUB-153 (E10) — bind the Foundry world to a single DMhub campaign.
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

  // DMHUB-153 (E10) — set programmatically by the Pick Session dialog.
  game.settings.register(MODULE_ID, "activeSessionId", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // DMHUB-153 (E10) — queue of quick-notes / edits captured during a brief
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
    `modules/${MODULE_ID}/templates/confirm-overwrite.hbs`
  ]);
});

Hooks.once("ready", () => {
  const client = new GMhubClient({
    getBaseUrl: () => game.settings.get(MODULE_ID, "baseUrl"),
    getApiKey: () => game.settings.get(MODULE_ID, "apiKey")
  });
  const sync = new SyncService(client);

  game.modules.get(MODULE_ID).api = {
    client,
    sync,
    openDialog: () => new SyncDialog(sync).render(true),
    openPickSession: () => new PickSessionDialog(client).render(true)
  };
});

Hooks.on("renderJournalDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const button = $(`<button class="gmhub-sync-button"><i class="fas fa-cloud"></i> ${game.i18n.localize("GMHUB.Button.OpenDialog")}</button>`);
  button.on("click", () => game.modules.get(MODULE_ID).api.openDialog());
  html.find(".directory-header .header-actions").append(button);
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

// DMHUB-155 (E12). On any GM-driven journal edit, mark the entry dirty so
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

Hooks.on("updateJournalEntryPage", async (page, _change, _options, userId) => {
  if (game.user.id !== userId) return;
  if (!game.user.isGM) return;
  try {
    await page.setFlag(MODULE_ID, "dirty", true);
  } catch (err) {
    console.warn("[gmhub-vtt] page markDirty failed", err);
  }
});
