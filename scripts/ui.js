// GMhub VTT Bridge — Foundry Application classes (GMHUB-153 / E10).
//
// Dialogs:
//   SyncDialog          The main hub.
//   PickSessionDialog   Lists prepped sessions for the bound campaign.
//   ConfirmOverwriteDialog Pre-pull warning when local journals are dirty.
//   AgendaEditorDialog  Structured agenda/pinned editor.
//   PlayerMapDialog     (0015) GM-only mapping of GMhub players to
//                       Foundry users, used by selective-reveal sync.
//   RevealMenuDialog    (0015) Per-note popover that grants/revokes
//                       per-player access via the gmhub-app API.

import { MODULE_ID } from "./main.js";
import { describePingFailure, describePingResult, safeCall } from "./error-toaster.js";
import { renderAgendaHtml, renderPinnedHtml, SESSION_PLAN_FLAGS, SESSION_PLAN_PAGE_NAMES } from "./sync.js";

function statusLabel(session) {
  if (session.ended_at) return "ended";
  if (session.paused_at) return "paused";
  if (session.started_at) return "live";
  return "prep";
}

function lifecycleAvailableFor(status) {
  switch (status) {
    case "prep":   return { start: true,  pause: false, resume: false, end: false };
    case "live":   return { start: false, pause: true,  resume: false, end: true  };
    case "paused": return { start: false, pause: false, resume: true,  end: true  };
    default:       return { start: false, pause: false, resume: false, end: false };
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export class SyncDialog extends Application {
  constructor(sync, options = {}) {
    super(options);
    this.sync = sync;
    this.status = "";
    this.output = "";
    this.sessionStatus = null;
    this.sessionStatusError = null;
    this.lifecycleBusy = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-sync-dialog",
      title: "GMhub Sync",
      template: `modules/${MODULE_ID}/templates/sync-dialog.hbs`,
      width: 520,
      height: "auto",
      classes: ["gmhub-sync-dialog"]
    });
  }

  getData() {
    const lifecycle = lifecycleAvailableFor(this.sessionStatus);
    const anyLifecycleVisible = lifecycle.start || lifecycle.pause || lifecycle.resume || lifecycle.end;
    return {
      baseUrl: game.settings.get(MODULE_ID, "baseUrl"),
      campaignId: game.settings.get(MODULE_ID, "campaignId"),
      activeSessionId: game.settings.get(MODULE_ID, "activeSessionId"),
      lastPullAt: game.settings.get(MODULE_ID, "lastPullAt") || game.i18n.localize("GMHUB.Dialog.Never"),
      status: this.status,
      output: this.output,
      sessionStatus: this.sessionStatus,
      sessionStatusError: this.sessionStatusError,
      lifecycle,
      anyLifecycleVisible,
      lifecycleBusy: this.lifecycleBusy
    };
  }

  async _refreshSessionStatus() {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    const sessionId = game.settings.get(MODULE_ID, "activeSessionId");
    if (!campaignId || !sessionId) {
      this.sessionStatus = null;
      this.sessionStatusError = null;
      return;
    }
    try {
      const session = await this.sync.client.getSession(campaignId, sessionId);
      this.sessionStatus = session ? statusLabel(session) : null;
      this.sessionStatusError = null;
    } catch (err) {
      this.sessionStatus = null;
      this.sessionStatusError = err.message ?? String(err);
    }
  }

  async _runLifecycle(action, { confirm = false } = {}) {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    const sessionId = game.settings.get(MODULE_ID, "activeSessionId");
    if (!campaignId || !sessionId) return;

    if (confirm) {
      const ok = await new Promise((resolve) => {
        let resolved = false;
        const dialog = new LifecycleConfirmDialog({
          action,
          onConfirm: () => { resolved = true; resolve(true); }
        });
        const origClose = dialog.close.bind(dialog);
        dialog.close = async (...args) => {
          if (!resolved) resolve(false);
          return origClose(...args);
        };
        dialog.render(true);
      });
      if (!ok) return;
    }

    this.lifecycleBusy = true;
    this._setStatus(game.i18n.localize(`GMHUB.Notify.Lifecycle.${capitalize(action)}.InProgress`));
    try {
      await safeCall(() => this.sync.client.transitionLifecycle(campaignId, sessionId, action));
      await this._refreshSessionStatus();
      this.lifecycleBusy = false;
      const doneKey = `GMHUB.Notify.Lifecycle.${capitalize(action)}.Done`;
      ui.notifications.info(game.i18n.localize(doneKey));
      this._setStatus(game.i18n.localize(doneKey));
    } catch (err) {
      this.lifecycleBusy = false;
      this._setStatus(
        game.i18n.localize(`GMHUB.Notify.Lifecycle.${capitalize(action)}.Failed`),
        err.message ?? ""
      );
    }
  }

  activateListeners(html) {
    super.activateListeners(html);

    if (this.sessionStatus === null && this.sessionStatusError === null) {
      const sessionId = game.settings.get(MODULE_ID, "activeSessionId");
      if (sessionId) this._refreshSessionStatus().then(() => this.render(false));
    }

    html.find('[data-action="open-settings"]').on("click", () => {
      const settingsApp = new SettingsConfig();
      settingsApp.render(true, { focus: true });
    });

    html.find('[data-action="pick-session"]').on("click", () => {
      const picker = new PickSessionDialog(this.sync.client, {
        onPicked: (session) => {
          this._setStatus(game.i18n.format("GMHUB.Notify.SessionBound", { name: session.title }));
        }
      });
      picker.render(true);
    });

    html.find('[data-action="session-start"]').on("click", () => this._runLifecycle("start"));
    html.find('[data-action="session-pause"]').on("click", () => this._runLifecycle("pause"));
    html.find('[data-action="session-resume"]').on("click", () => this._runLifecycle("resume"));
    html.find('[data-action="session-end"]').on("click", () => this._runLifecycle("end", { confirm: true }));

    html.find('[data-action="ping"]').on("click", async () => {
      this._setStatus(game.i18n.localize("GMHUB.Notify.Pinging"));
      try {
        const principal = await safeCall(() => this.sync.client.ping());
        this._setStatus(
          game.i18n.localize("GMHUB.Notify.PingDone"),
          describePingResult(principal)
        );
      } catch (err) {
        this._setStatus(
          game.i18n.localize("GMHUB.Notify.PingFailed"),
          describePingFailure(err)
        );
      }
    });

    html.find('[data-action="pull"]').on("click", async () => {
      this._setStatus(game.i18n.localize("GMHUB.Notify.Pulling"));
      try {
        const result = await safeCall(() =>
          this.sync.pullAll({
            confirmOverwrite: (dirtyEntries) =>
              new Promise((resolve) => {
                let resolved = false;
                const dialog = new ConfirmOverwriteDialog({
                  dirtyEntries: dirtyEntries.map((e) => ({ name: e.name })),
                  onConfirm: () => {
                    resolved = true;
                    resolve(true);
                  }
                });
                dialog.options.callbacks = dialog.options.callbacks ?? {};
                const origClose = dialog.close.bind(dialog);
                dialog.close = async (...args) => {
                  if (!resolved) resolve(false);
                  return origClose(...args);
                };
                dialog.render(true);
              })
          })
        );
        if (result?.cancelled) {
          this._setStatus(game.i18n.localize("GMHUB.Notify.PullCancelled"));
          return;
        }
        const r = result?.pulled ?? { entities: 0, notes: 0, sessions: 0 };
        const summary = `entities: ${r.entities}, notes: ${r.notes}, sessions: ${r.sessions}`;
        const errs = (result?.errors ?? []).map((e) => `${e.name}: ${e.message}`).join("\n");
        this._setStatus(
          game.i18n.localize("GMHUB.Notify.PullDone"),
          `${summary}${errs ? "\n\n" + errs : ""}`
        );
      } catch (err) {
        this._setStatus(
          game.i18n.localize("GMHUB.Notify.PullFailed"),
          err.message ?? ""
        );
      }
    });

    html.find('[data-action="push"]').on("click", async () => {
      const preview = this.sync.previewPush();
      if (preview.error === "no_campaign_bound") {
        this._setStatus(game.i18n.localize("GMHUB.Notify.PushFailed"), preview.error);
        return;
      }
      const confirmed = await new Promise((resolve) => {
        let resolved = false;
        const dialog = new PushPreviewDialog({
          preview,
          onConfirm: () => { resolved = true; resolve(true); }
        });
        const origClose = dialog.close.bind(dialog);
        dialog.close = async (...args) => {
          if (!resolved) resolve(false);
          return origClose(...args);
        };
        dialog.render(true);
      });
      if (!confirmed) {
        this._setStatus(game.i18n.localize("GMHUB.Notify.PushCancelled"));
        return;
      }
      this._setStatus(game.i18n.localize("GMHUB.Notify.Pushing"));
      try {
        const result = await safeCall(() => this.sync.pushAll());
        const p = result?.pushed ?? { entities: 0, notes: 0, sessionPlans: 0, quickNotes: 0 };
        const summary = `entities: ${p.entities}, notes: ${p.notes}, sessions: ${p.sessionPlans}, quick notes: ${p.quickNotes}`;
        const errs = (result?.errors ?? []).map((e) => `${e.name}: ${e.message}`).join("\n");
        this._setStatus(
          `${game.i18n.localize("GMHUB.Notify.PushDone")} (${result?.failed ?? 0} failed)`,
          `${summary}${errs ? "\n\n" + errs : ""}`
        );
      } catch (err) {
        this._setStatus(
          game.i18n.localize("GMHUB.Notify.PushFailed"),
          err.message ?? ""
        );
      }
    });
  }

  _setStatus(message, output = "") {
    this.status = message;
    this.output = output;
    this.render(false);
  }
}

export class LifecycleConfirmDialog extends Application {
  constructor({ action, onConfirm = () => {} } = {}, options = {}) {
    super(options);
    this.action = action;
    this.onConfirm = onConfirm;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-lifecycle-confirm",
      title: "Confirm session action",
      template: `modules/${MODULE_ID}/templates/lifecycle-confirm.hbs`,
      width: 460,
      height: "auto",
      classes: ["gmhub-lifecycle-confirm-dialog"]
    });
  }

  getData() {
    const action = this.action;
    return {
      action,
      titleKey: `GMHUB.Dialog.LifecycleConfirm.${capitalize(action)}.Title`,
      bodyKey: `GMHUB.Dialog.LifecycleConfirm.${capitalize(action)}.Body`,
      confirmKey: `GMHUB.Button.Session${capitalize(action)}`
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('[data-action="cancel"]').on("click", () => this.close());
    html.find('[data-action="confirm"]').on("click", () => {
      this.onConfirm();
      this.close();
    });
  }
}

export class PushPreviewDialog extends Application {
  constructor({ preview = null, onConfirm = () => {} } = {}, options = {}) {
    super(options);
    this.preview = preview;
    this.onConfirm = onConfirm;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-push-preview",
      title: "Push preview",
      template: `modules/${MODULE_ID}/templates/push-preview.hbs`,
      width: 520,
      height: "auto",
      classes: ["gmhub-push-preview-dialog"]
    });
  }

  getData() {
    const p = this.preview ?? {};
    const sessionPlanFields = [];
    const sp = p.sessionPlan ?? {};
    if (sp.gmNotes) sessionPlanFields.push("gm_notes");
    if (sp.gmSecrets) sessionPlanFields.push("gm_secrets");
    if (sp.agenda) sessionPlanFields.push("agenda");
    if (sp.pinned) sessionPlanFields.push("pinned");
    return {
      empty: (p.total ?? 0) === 0,
      entitiesCreate: p.entities?.create ?? [],
      entitiesUpdate: p.entities?.update ?? [],
      notesCreate: p.notes?.create ?? [],
      notesUpdate: p.notes?.update ?? [],
      sessionPlanFields,
      sessionPlanLabel: sessionPlanFields.length ? sessionPlanFields.join(", ") : null,
      sessionPlanJournals: p.sessionPlanJournals ?? [],
      quickNotes: p.quickNotes ?? 0
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('[data-action="cancel"]').on("click", () => this.close());
    html.find('[data-action="confirm"]').on("click", () => {
      this.onConfirm();
      this.close();
    });
  }
}

export class AgendaEditorDialog extends Application {
  constructor({ page, kind } = {}, options = {}) {
    super(options);
    this.page = page;
    this.kind = kind;
    const flagKey = SESSION_PLAN_FLAGS[kind];
    const raw = page?.getFlag(MODULE_ID, flagKey) ?? [];
    this.items = JSON.parse(JSON.stringify(Array.isArray(raw) ? raw : []));
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-agenda-editor",
      title: "Edit",
      template: `modules/${MODULE_ID}/templates/agenda-editor.hbs`,
      width: 560,
      height: "auto",
      classes: ["gmhub-agenda-editor-dialog"]
    });
  }

  get title() {
    const titleKey = this.kind === "pinned"
      ? "GMHUB.Dialog.AgendaEditor.Title.Pinned"
      : "GMHUB.Dialog.AgendaEditor.Title.Agenda";
    return game.i18n.localize(titleKey);
  }

  getData() {
    return {
      kind: this.kind,
      isAgenda: this.kind === "agenda",
      isPinned: this.kind === "pinned",
      items: this.items.map((item, idx) => ({ ...item, _idx: idx }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="add"]').on("click", () => {
      if (this.kind === "agenda") {
        this.items.push({ title: "", estimated_duration_min: 0, notes: "" });
      } else {
        this.items.push({ entity_type: "npc", name: "", entity_id: "" });
      }
      this.render(false);
    });

    html.find('[data-action="remove"]').on("click", (evt) => {
      const idx = Number(evt.currentTarget.dataset.idx);
      if (Number.isInteger(idx)) {
        this.items.splice(idx, 1);
        this.render(false);
      }
    });

    html.find('[data-action="up"]').on("click", (evt) => {
      const idx = Number(evt.currentTarget.dataset.idx);
      if (idx > 0) {
        [this.items[idx - 1], this.items[idx]] = [this.items[idx], this.items[idx - 1]];
        this.render(false);
      }
    });

    html.find('[data-action="down"]').on("click", (evt) => {
      const idx = Number(evt.currentTarget.dataset.idx);
      if (Number.isInteger(idx) && idx < this.items.length - 1) {
        [this.items[idx], this.items[idx + 1]] = [this.items[idx + 1], this.items[idx]];
        this.render(false);
      }
    });

    html.find('[data-field]').on("input change", (evt) => {
      const idx = Number(evt.currentTarget.dataset.idx);
      const field = evt.currentTarget.dataset.field;
      if (!Number.isInteger(idx) || !field) return;
      const item = this.items[idx];
      if (!item) return;
      const value = evt.currentTarget.value;
      if (field === "estimated_duration_min") {
        item[field] = Number(value) || 0;
      } else {
        item[field] = value;
      }
    });

    html.find('[data-action="cancel"]').on("click", () => this.close());

    html.find('[data-action="save"]').on("click", async () => {
      try {
        const flagKey = SESSION_PLAN_FLAGS[this.kind];
        const clean = this.items.map((item) => {
          const { _idx, ...rest } = item;
          return rest;
        });
        await this.page.setFlag(MODULE_ID, flagKey, clean);
        const html = this.kind === "agenda"
          ? renderAgendaHtml(clean)
          : renderPinnedHtml(clean);
        await this.page.update({ "text.content": html });
        await this.page.setFlag(MODULE_ID, "dirty", true);
        ui.notifications.info(game.i18n.localize("GMHUB.Notify.AgendaSaved"));
        this.close();
      } catch (err) {
        ui.notifications.error(err.message ?? String(err));
      }
    });
  }
}

export function openAgendaEditorForPage(page) {
  if (!page) return;
  if (page.name === SESSION_PLAN_PAGE_NAMES.agenda) {
    new AgendaEditorDialog({ page, kind: "agenda" }).render(true);
  } else if (page.name === SESSION_PLAN_PAGE_NAMES.pinned) {
    new AgendaEditorDialog({ page, kind: "pinned" }).render(true);
  }
}

export class ConfirmOverwriteDialog extends Application {
  constructor({ dirtyEntries = [], onConfirm = () => {} } = {}, options = {}) {
    super(options);
    this.dirtyEntries = dirtyEntries;
    this.onConfirm = onConfirm;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-confirm-overwrite",
      title: "Confirm overwrite",
      template: `modules/${MODULE_ID}/templates/confirm-overwrite.hbs`,
      width: 480,
      height: "auto",
      classes: ["gmhub-confirm-overwrite-dialog"]
    });
  }

  getData() {
    return {
      dirtyCount: this.dirtyEntries.length,
      dirtyEntries: this.dirtyEntries
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('[data-action="cancel"]').on("click", () => this.close());
    html.find('[data-action="overwrite"]').on("click", () => {
      this.onConfirm();
      this.close();
    });
  }
}

export class PickSessionDialog extends Application {
  constructor(client, options = {}) {
    super(options);
    this.client = client;
    this.onPicked = options.onPicked ?? (() => {});
    this.sessions = [];
    this.loading = true;
    this.error = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-pick-session-dialog",
      title: "Pick a prepped session",
      template: `modules/${MODULE_ID}/templates/pick-session.hbs`,
      width: 520,
      height: "auto",
      classes: ["gmhub-pick-session-dialog"]
    });
  }

  async _refresh() {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) {
      this.loading = false;
      this.error = game.i18n.localize("GMHUB.PickSession.NoCampaign");
      this.sessions = [];
      this.render(false);
      return;
    }
    this.loading = true;
    this.error = null;
    this.render(false);
    try {
      const sessions = (typeof this.client.listSessions === "function")
        ? await this.client.listSessions(campaignId)
        : [];
      this.sessions = (sessions ?? []).map((s) => ({
        ...s,
        statusLabel: statusLabel(s)
      }));
    } catch (err) {
      this.error = err.message ?? String(err);
      this.sessions = [];
    }
    this.loading = false;
    this.render(false);
  }

  getData() {
    return {
      loading: this.loading,
      error: this.error,
      sessions: this.sessions
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (this.loading && !this.error) this._refresh();

    html.find('[data-action="refresh"]').on("click", () => this._refresh());

    html.find('[data-action="pick"]').on("click", async (evt) => {
      const sessionId = evt.currentTarget.dataset.sessionId;
      if (!sessionId) return;
      const session = this.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      await game.settings.set(MODULE_ID, "activeSessionId", sessionId);
      this.onPicked(session);
      this.close();
    });
  }
}

/* ------------------------------------------------------------------ */
/* 0015 — Player slot mapping (GM-only world setting submenu)          */
/* ------------------------------------------------------------------ */

export class PlayerMapDialog extends FormApplication {
  constructor(object = {}, options = {}) {
    super(object, options);
    this.players = [];
    this.loading = true;
    this.error = null;
    this.mapping = { ...(game.settings.get(MODULE_ID, "playerMap") ?? {}) };
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-player-map",
      title: "GMhub Player Mapping",
      template: `modules/${MODULE_ID}/templates/player-map.hbs`,
      width: 560,
      height: "auto",
      classes: ["gmhub-player-map-dialog"],
      closeOnSubmit: true,
      submitOnChange: false,
      submitOnClose: false
    });
  }

  async _refresh() {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) {
      this.loading = false;
      this.error = game.i18n.localize("GMHUB.PickSession.NoCampaign");
      this.players = [];
      this.render(false);
      return;
    }
    this.loading = true;
    this.error = null;
    this.render(false);
    try {
      const client = game.modules.get(MODULE_ID).api?.client;
      if (!client) throw new Error("client_not_ready");
      this.players = await client.getPlayers(campaignId);
    } catch (err) {
      this.error = err.message ?? String(err);
      this.players = [];
    }
    this.loading = false;
    this.render(false);
  }

  getData() {
    const foundryUsers = (game.users?.contents ?? []).filter((u) => !u.isGM);
    const rows = (this.players ?? []).map((p) => {
      const mapped = this.mapping[p.user_id] ?? "";
      const choices = foundryUsers.map((u) => ({
        id: u.id,
        name: u.name,
        selected: u.id === mapped
      }));
      return {
        user_id: p.user_id,
        display_name: p.display_name,
        choices
      };
    });
    return {
      loading: this.loading,
      error: this.error,
      empty: !this.loading && !this.error && rows.length === 0,
      rows
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (this.loading && !this.error) this._refresh();
    html.find('[data-action="refresh"]').on("click", () => this._refresh());
  }

  async _updateObject(_event, formData) {
    const next = {};
    for (const [key, value] of Object.entries(formData ?? {})) {
      if (!key.startsWith("player.")) continue;
      const userId = key.slice("player.".length);
      if (typeof value === "string" && value.length > 0) {
        next[userId] = value;
      }
    }
    await game.settings.set(MODULE_ID, "playerMap", next);
    ui.notifications?.info(game.i18n.localize("GMHUB.Notify.PlayerMapSaved"));
  }
}

/* ------------------------------------------------------------------ */
/* 0015 — Per-note selective reveal popover                            */
/* ------------------------------------------------------------------ */

export class RevealMenuDialog extends Application {
  constructor({ page, client } = {}, options = {}) {
    super(options);
    this.page = page;
    this.client = client;
    this.players = [];
    this.loading = true;
    this.error = null;
    this.pending = false;
    const initial = page?.getFlag(MODULE_ID, "revealedTo") ?? [];
    this.selected = new Set(Array.isArray(initial) ? initial : []);
    this.initial = new Set(this.selected);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-reveal-menu",
      title: "Reveal to specific players",
      template: `modules/${MODULE_ID}/templates/reveal-menu.hbs`,
      width: 480,
      height: "auto",
      classes: ["gmhub-reveal-menu-dialog"]
    });
  }

  async _refresh() {
    const campaignId = game.settings.get(MODULE_ID, "campaignId");
    if (!campaignId) {
      this.loading = false;
      this.error = game.i18n.localize("GMHUB.PickSession.NoCampaign");
      this.render(false);
      return;
    }
    if (!this.client) {
      this.loading = false;
      this.error = "client_not_ready";
      this.render(false);
      return;
    }
    this.loading = true;
    this.error = null;
    this.render(false);
    try {
      this.players = await this.client.getPlayers(campaignId);
    } catch (err) {
      this.error = err.message ?? String(err);
      this.players = [];
    }
    this.loading = false;
    this.render(false);
  }

  getData() {
    const playerMap = game.settings.get(MODULE_ID, "playerMap") ?? {};
    const rows = (this.players ?? []).map((p) => ({
      user_id: p.user_id,
      display_name: p.display_name,
      checked: this.selected.has(p.user_id),
      unmapped: !playerMap[p.user_id]
    }));
    const anyUnmapped = rows.some((r) => r.unmapped);
    return {
      loading: this.loading,
      error: this.error,
      empty: !this.loading && !this.error && rows.length === 0,
      pending: this.pending,
      anyUnmapped,
      rows
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (this.loading && !this.error) this._refresh();

    html.find('[data-action="toggle"]').on("change", (evt) => {
      const userId = evt.currentTarget.dataset.userId;
      if (!userId) return;
      if (evt.currentTarget.checked) {
        this.selected.add(userId);
      } else {
        this.selected.delete(userId);
      }
    });

    html.find('[data-action="select-all"]').on("click", () => {
      for (const p of this.players) this.selected.add(p.user_id);
      this.render(false);
    });

    html.find('[data-action="clear-all"]').on("click", () => {
      this.selected.clear();
      this.render(false);
    });

    html.find('[data-action="cancel"]').on("click", () => this.close());

    html.find('[data-action="save"]').on("click", async () => {
      if (this.pending) return;
      const campaignId = game.settings.get(MODULE_ID, "campaignId");
      const noteId = this.page?.getFlag(MODULE_ID, "externalId");
      if (!campaignId || !noteId) {
        ui.notifications?.error(game.i18n.localize("GMHUB.Notify.RevealFailed"));
        return;
      }

      const add = [];
      const remove = [];
      for (const id of this.selected) {
        if (!this.initial.has(id)) add.push(id);
      }
      for (const id of this.initial) {
        if (!this.selected.has(id)) remove.push(id);
      }
      if (add.length === 0 && remove.length === 0) {
        this.close();
        return;
      }

      this.pending = true;
      this.render(false);
      try {
        await this.client.setNotePlayerReveal(campaignId, noteId, { add, remove });
        const nextList = Array.from(this.selected);
        await this.page.setFlag(MODULE_ID, "revealedTo", nextList);
        // Refresh local ownership so the UI reflects the new access
        // immediately, without waiting for the next Pull.
        const { computePageOwnership } = await import("./sync.js");
        const { ownership } = computePageOwnership({
          visibility: this.page.getFlag(MODULE_ID, "visibility"),
          revealedTo: nextList
        });
        await this.page.update({ ownership });
        ui.notifications?.info(game.i18n.localize("GMHUB.Notify.RevealSaved"));
        this.close();
      } catch (err) {
        this.pending = false;
        ui.notifications?.error(err.message ?? game.i18n.localize("GMHUB.Notify.RevealFailed"));
        this.render(false);
      }
    });
  }
}

export function openRevealMenuForPage(page, client) {
  if (!page || !client) return;
  new RevealMenuDialog({ page, client }).render(true);
}
