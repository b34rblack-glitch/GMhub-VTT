// GMhub VTT Bridge — Foundry Application classes (DMHUB-153 / E10).
//
// Three dialogs:
//   SyncDialog          The main hub. Renders one of three states:
//                         • no campaign → button to module settings
//                         • campaign set, no session → "Pick session" button
//                         • ready → ping / pull / push / re-pick session
//   PickSessionDialog   Lists prepped sessions for the bound campaign;
//                         selecting one writes activeSessionId and closes.
//   ConfirmOverwriteDialog
//                       Pre-pull warning when local journals carry
//                         flags.gmhub-vtt.dirty (unpushed edits).
//
// The actual pull/push wiring lands in E12; the friendly-error toasts in E13.
// Test Connection wiring lands in E13. Scope of E10 is scaffolding only.

import { MODULE_ID } from "./main.js";
import { describePingFailure, describePingResult, safeCall } from "./error-toaster.js";

function statusLabel(session) {
  if (session.ended_at) return "ended";
  if (session.paused_at) return "paused";
  if (session.started_at) return "live";
  return "prep";
}

export class SyncDialog extends Application {
  constructor(sync, options = {}) {
    super(options);
    this.sync = sync;
    this.status = "";
    this.output = "";
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
    return {
      baseUrl: game.settings.get(MODULE_ID, "baseUrl"),
      campaignId: game.settings.get(MODULE_ID, "campaignId"),
      activeSessionId: game.settings.get(MODULE_ID, "activeSessionId"),
      lastPullAt: game.settings.get(MODULE_ID, "lastPullAt") || game.i18n.localize("GMHUB.Dialog.Never"),
      status: this.status,
      output: this.output
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="open-settings"]').on("click", () => {
      // Foundry's standard way of opening Module Settings for a specific module.
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
        const r = result?.pulled ?? { entities: 0, notes: 0, sessionPlan: false };
        const summary = `entities: ${r.entities}, notes: ${r.notes}, session plan: ${r.sessionPlan ? "yes" : "no"}`;
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
      this._setStatus(game.i18n.localize("GMHUB.Notify.Pushing"));
      try {
        const result = await safeCall(() => this.sync.pushAll());
        const p = result?.pushed ?? { entities: 0, notes: 0, sessionPlan: false, quickNotes: 0 };
        const summary = `entities: ${p.entities}, notes: ${p.notes}, session plan: ${p.sessionPlan ? "yes" : "no"}, quick notes: ${p.quickNotes}`;
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

// DMHUB-153 (E10). FormApplication subclass — even though we don't submit a
// form, FormApplication gives us focus management + close-on-Escape semantics
// without rolling our own.
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
      // E11 ships listSessions; until then it returns an empty array. The
      // template already renders the empty-state message in that case.
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
