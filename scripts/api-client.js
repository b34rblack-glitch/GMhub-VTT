// GMhub VTT Bridge — GMhub /api/v1/* client (GMHUB-154 / E11).
//
// Live spec: ${baseUrl}/docs (or GET /api/v1/openapi.json).
// One method per E5/E6 endpoint, plus an iterateAll() helper for cursor
// pagination. Re-reads baseUrl + apiKey from game.settings on every request
// so settings changes apply without reloading the world.

export class GmhubApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {object|null} body parsed JSON body or null on non-JSON responses
   */
  constructor(status, body) {
    const reason = body && body.reason ? body.reason : `http_${status}`;
    super(reason);
    this.name = "GmhubApiError";
    this.status = status;
    this.body = body ?? {};
  }
}

export class GmhubClient {
  constructor({ getBaseUrl, getApiKey }) {
    this.getBaseUrl = getBaseUrl;
    this.getApiKey = getApiKey;
  }

  _url(path, query) {
    const base = (this.getBaseUrl() || "").replace(/\/+$/, "");
    let url = `${base}/api/v1${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        params.set(k, String(v));
      }
      const q = params.toString();
      if (q) url += `?${q}`;
    }
    return url;
  }

  async _request(method, path, body, query) {
    let key = this.getApiKey();
    if (!key) throw new GmhubApiError(401, { error: "unauthorized", reason: "missing_credentials" });

    const doFetch = async () => {
      return fetch(this._url(path, query), {
        method,
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    };

    let res = await doFetch();

    // 401 missing_credentials: re-read settings once and retry — catches the
    // "GM just pasted the key" race where the module instance was constructed
    // before the world had a token configured.
    if (res.status === 401) {
      const reread = this.getApiKey();
      if (reread && reread !== key) {
        key = reread;
        res = await doFetch();
      }
    }

    if (res.status === 204) return null;

    const text = await res.text().catch(() => "");
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    if (!res.ok) {
      throw new GmhubApiError(res.status, json);
    }
    return json;
  }

  // ---- Identity ----

  /** GET /ping — auth check; returns the principal { ok, user_id, token_id, scopes }. */
  ping() {
    return this._request("GET", "/ping");
  }

  // ---- Campaigns ----

  /** GET /campaigns — list campaigns the caller is a member of. */
  listCampaigns() {
    return this._request("GET", "/campaigns");
  }

  /** GET /campaigns/{id} — campaign metadata + role. */
  getCampaign(campaignId) {
    return this._request("GET", `/campaigns/${encodeURIComponent(campaignId)}`);
  }

  // ---- Entities ----

  /** GET /campaigns/{id}/entities — paginated list. */
  listEntities(campaignId, opts = {}) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/entities`,
      undefined,
      opts
    );
  }

  /** GET /campaigns/{id}/entities/{entityId} — entity detail. */
  getEntity(campaignId, entityId) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/entities/${encodeURIComponent(entityId)}`
    );
  }

  /** POST /campaigns/{id}/entities — create. */
  createEntity(campaignId, body) {
    return this._request(
      "POST",
      `/campaigns/${encodeURIComponent(campaignId)}/entities`,
      body
    );
  }

  /** PATCH /campaigns/{id}/entities/{entityId} — partial update. */
  updateEntity(campaignId, entityId, body) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/entities/${encodeURIComponent(entityId)}`,
      body
    );
  }

  /** DELETE /campaigns/{id}/entities/{entityId} — idempotent. */
  deleteEntity(campaignId, entityId) {
    return this._request(
      "DELETE",
      `/campaigns/${encodeURIComponent(campaignId)}/entities/${encodeURIComponent(entityId)}`
    );
  }

  /** PATCH /campaigns/{id}/entities/{entityId}/visibility — flip visibility. */
  setEntityVisibility(campaignId, entityId, visibility) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/entities/${encodeURIComponent(entityId)}/visibility`,
      { visibility }
    );
  }

  /** PATCH /campaigns/{id}/entities/{entityId}/reveal — set/clear reveal. */
  setEntityReveal(campaignId, entityId, revealed) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/entities/${encodeURIComponent(entityId)}/reveal`,
      { revealed: !!revealed }
    );
  }

  // ---- Notes ----

  /** GET /campaigns/{id}/notes — paginated list. */
  listNotes(campaignId, opts = {}) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/notes`,
      undefined,
      opts
    );
  }

  /** GET /campaigns/{id}/notes/{noteId} — note detail. */
  getNote(campaignId, noteId) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/notes/${encodeURIComponent(noteId)}`
    );
  }

  /** POST /campaigns/{id}/notes — create. */
  createNote(campaignId, body) {
    return this._request(
      "POST",
      `/campaigns/${encodeURIComponent(campaignId)}/notes`,
      body
    );
  }

  /** PATCH /campaigns/{id}/notes/{noteId} — partial update. */
  updateNote(campaignId, noteId, body) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/notes/${encodeURIComponent(noteId)}`,
      body
    );
  }

  /** DELETE /campaigns/{id}/notes/{noteId} — idempotent. */
  deleteNote(campaignId, noteId) {
    return this._request(
      "DELETE",
      `/campaigns/${encodeURIComponent(campaignId)}/notes/${encodeURIComponent(noteId)}`
    );
  }

  /** PATCH /campaigns/{id}/notes/{noteId}/visibility — flip visibility. */
  setNoteVisibility(campaignId, noteId, visibility) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/notes/${encodeURIComponent(noteId)}/visibility`,
      { visibility }
    );
  }

  // ---- Sessions ----

  /** GET /campaigns/{id}/sessions — paginated list (used by E10's picker). */
  async listSessions(campaignId, opts = {}) {
    const page = await this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions`,
      undefined,
      opts
    );
    // The picker UI just wants a flat list; if the caller doesn't pass a
    // cursor, the convenience contract is to return data directly.
    return Array.isArray(page) ? page : page?.data ?? [];
  }

  /** GET /campaigns/{id}/sessions/{sessionId} — session detail. */
  getSession(campaignId, sessionId) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}`
    );
  }

  /** GET /campaigns/{id}/sessions/active — running session, or null on 404. */
  async getActiveSession(campaignId) {
    try {
      return await this._request(
        "GET",
        `/campaigns/${encodeURIComponent(campaignId)}/sessions/active`
      );
    } catch (err) {
      if (err instanceof GmhubApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** GET /campaigns/{id}/sessions/{sessionId}/plan — gm_secrets gated by scope. */
  getSessionPlan(campaignId, sessionId) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}/plan`
    );
  }

  /**
   * PATCH /campaigns/{id}/sessions/{sessionId}/plan — partial update.
   * Body: { gm_notes?, gm_secrets?, agenda?, plan_state? }. gm_secrets
   * additionally requires the sessions:secrets scope.
   */
  updateSessionPlan(campaignId, sessionId, body) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}/plan`,
      body
    );
  }

  /** POST /campaigns/{id}/sessions/{sessionId}/quick-notes — append. */
  addQuickNote(campaignId, sessionId, body) {
    return this._request(
      "POST",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}/quick-notes`,
      body
    );
  }

  /** POST /campaigns/{id}/sessions/{sessionId}/lifecycle — action transitions. */
  transitionLifecycle(campaignId, sessionId, action) {
    return this._request(
      "POST",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}/lifecycle`,
      { action }
    );
  }

  // ---- Helpers ----

  /**
   * Walk every page of a list endpoint, yielding individual rows. Caller:
   *   for await (const e of client.iterateAll((opts) => client.listEntities(cid, opts))) { … }
   *
   * Stops when meta.cursor is null. Bounded by `safetyLimit` to avoid runaway
   * loops if the server ever returns a stuck cursor.
   */
  async *iterateAll(listFn, args = {}, safetyLimit = 1000) {
    let cursor = args.cursor ?? null;
    let yielded = 0;
    for (;;) {
      const page = await listFn({ ...args, cursor: cursor ?? undefined });
      const data = Array.isArray(page) ? page : page?.data ?? [];
      for (const row of data) {
        yield row;
        yielded += 1;
        if (yielded >= safetyLimit) return;
      }
      const next = (Array.isArray(page) ? null : page?.meta?.cursor) ?? null;
      if (!next || next === cursor) return;
      cursor = next;
    }
  }
}
