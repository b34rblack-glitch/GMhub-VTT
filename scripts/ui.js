import { MODULE_ID } from "./main.js";

export class SyncDialog extends Application {
  constructor(sync, options = {}) {
    super(options);
    this.sync = sync;
    this.status = "";
    this.lastResult = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gmhub-sync-dialog",
      title: "GMhub Sync",
      template: `modules/${MODULE_ID}/templates/sync-dialog.hbs`,
      width: 480,
      height: "auto",
      classes: ["gmhub-sync-dialog"]
    });
  }

  getData() {
    const result = this.lastResult
      ? { ...this.lastResult, isPush: this.lastResult.kind === "push", isPull: this.lastResult.kind === "pull" }
      : null;
    return {
      baseUrl: game.settings.get(MODULE_ID, "baseUrl"),
      hasKey: !!game.settings.get(MODULE_ID, "apiKey"),
      lastPullAt: game.settings.get(MODULE_ID, "lastPullAt") || "never",
      status: this.status,
      result
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="ping"]').on("click", async () => {
      this._setStatus("Pinging GMhub…");
      try {
        await this.sync.client.ping();
        this._setStatus("Connection OK");
      } catch (err) {
        this._setStatus(`Connection failed: ${err.message}`);
      }
    });

    html.find('[data-action="push-all"]').on("click", async () => {
      this._setStatus("Pushing all journals…");
      try {
        const result = await this.sync.pushAll();
        this.lastResult = { kind: "push", ...result };
        this._setStatus(`Pushed ${result.pushed}, failed ${result.failed}`);
      } catch (err) {
        this._setStatus(`Push failed: ${err.message}`);
      }
    });

    html.find('[data-action="pull-all"]').on("click", async () => {
      this._setStatus("Pulling journals from GMhub…");
      try {
        const result = await this.sync.pullAll();
        this.lastResult = { kind: "pull", ...result };
        this._setStatus(`Pulled ${result.pulled}, failed ${result.failed}`);
      } catch (err) {
        this._setStatus(`Pull failed: ${err.message}`);
      }
    });
  }

  _setStatus(msg) {
    this.status = msg;
    this.render(false);
  }
}
