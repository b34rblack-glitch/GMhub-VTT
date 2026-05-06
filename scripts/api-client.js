export class GMhubClient {
  constructor({ getBaseUrl, getApiKey }) {
    this.getBaseUrl = getBaseUrl;
    this.getApiKey = getApiKey;
  }

  _url(path) {
    const base = (this.getBaseUrl() || "").replace(/\/+$/, "");
    return `${base}/api/v1${path}`;
  }

  async _request(method, path, body) {
    const key = this.getApiKey();
    if (!key) throw new Error("GMhub API key is not configured");

    const res = await fetch(this._url(path), {
      method,
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GMhub ${method} ${path} failed: ${res.status} ${text}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  listJournals({ updatedSince } = {}) {
    const qs = updatedSince ? `?updatedSince=${encodeURIComponent(updatedSince)}` : "";
    return this._request("GET", `/journals${qs}`);
  }

  getJournal(id) {
    return this._request("GET", `/journals/${encodeURIComponent(id)}`);
  }

  createJournal(payload) {
    return this._request("POST", `/journals`, payload);
  }

  updateJournal(id, payload) {
    return this._request("PUT", `/journals/${encodeURIComponent(id)}`, payload);
  }

  deleteJournal(id) {
    return this._request("DELETE", `/journals/${encodeURIComponent(id)}`);
  }

  ping() {
    return this._request("GET", `/ping`);
  }
}
