// GMhub VTT Bridge — GMhub /api/v1/* client.
//
// 0016 (Unified Visibility): one consolidated PATCH per resource. The
// legacy `setNotePlayerReveal`, `setEntityReveal`, `setNoteVisibility`,
// and `setEntityVisibility` helpers are gone — updateNote and
// updateEntity now carry `visibility` and `recipients` directly.

export class GmhubApiError extends Error {
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

    const doFetch = async () => fetch(this._url(path, query), {
      method,
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    let res = await doFetch();
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

    if (!res.ok) throw new GmhubApiError(res.status, json);
    return json;
  }

  // ---- Identity ----

  ping() { return this._request("GET", "/ping"); }

  // ---- Campaigns ----

  listCampaigns() { return this._request("GET", "/campaigns"); }

  getCampaign(campaignId) {
    return this._request("GET", `/campaigns/${encodeURIComponent(campaignId)}`);
  }

  /**
   * GET /campaigns/{id}/members — list of campaign members (GMs and
   * players) for the visibility recipient picker. Returns a flat
   * array of { user_id, display_name, role }.
   */
  async getMembers(campaignId) {
    const page = await this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/members`
    );
    return Array.isArray(page) ? page : page?.data ?? [];
  }

  // ---- Entities ----

  listEntities(campaignId, opts = {}) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/entities`,
      undefined,
      opts
    );
  }

  getEntity(campaignId, entityId) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/entities/${encodeURIComponent(entityId)}`
    );
  }

  createEntity(campaignId, body) {
    return this._request(
      "POST",
      `/campaigns/${encodeURIComponent(campaignId)}/entities`,
      body
    );
  }

  /**
   * PATCH /campaigns/{id}/entities/{id}. Body: any subset of
   * { name?, summary?, visibility?, recipients? }. The server
   * reconciles entity_player_reveals when visibility is `shared`.
   */
  updateEntity(campaignId, entityId, body) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/entities/${encodeURIComponent(entityId)}`,
      body
    );
  }

  deleteEntity(campaignId, entityId) {
    return this._request(
      "DELETE",
      `/campaigns/${encodeURIComponent(campaignId)}/entities/${encodeURIComponent(entityId)}`
    );
  }

  // ---- Notes ----

  listNotes(campaignId, opts = {}) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/notes`,
      undefined,
      opts
    );
  }

  getNote(campaignId, noteId) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/notes/${encodeURIComponent(noteId)}`
    );
  }

  createNote(campaignId, body) {
    return this._request(
      "POST",
      `/campaigns/${encodeURIComponent(campaignId)}/notes`,
      body
    );
  }

  /**
   * PATCH /campaigns/{id}/notes/{id}. Body: any subset of
   * { title?, body?, visibility?, recipients? }. The server
   * reconciles note_player_reveals when visibility is `shared`.
   */
  updateNote(campaignId, noteId, body) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/notes/${encodeURIComponent(noteId)}`,
      body
    );
  }

  deleteNote(campaignId, noteId) {
    return this._request(
      "DELETE",
      `/campaigns/${encodeURIComponent(campaignId)}/notes/${encodeURIComponent(noteId)}`
    );
  }

  // ---- Sessions ----

  async listSessions(campaignId, opts = {}) {
    const page = await this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions`,
      undefined,
      opts
    );
    return Array.isArray(page) ? page : page?.data ?? [];
  }

  getSession(campaignId, sessionId) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}`
    );
  }

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

  getSessionPlan(campaignId, sessionId) {
    return this._request(
      "GET",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}/plan`
    );
  }

  updateSessionPlan(campaignId, sessionId, body) {
    return this._request(
      "PATCH",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}/plan`,
      body
    );
  }

  addQuickNote(campaignId, sessionId, body) {
    return this._request(
      "POST",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}/quick-notes`,
      body
    );
  }

  transitionLifecycle(campaignId, sessionId, action) {
    return this._request(
      "POST",
      `/campaigns/${encodeURIComponent(campaignId)}/sessions/${encodeURIComponent(sessionId)}/lifecycle`,
      { action }
    );
  }

  // ---- Helpers ----

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
