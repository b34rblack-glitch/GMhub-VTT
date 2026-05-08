// GMhub VTT Bridge — friendly error toasts (DMHUB-156 / E13).
//
// Centralizes how the module renders DMhub /api/v1 errors to the GM. Every
// fetch call in sync.js + ui.js routes through safeCall so a 401/403/409/429
// becomes an actionable ui.notifications message instead of a raw exception
// in the console.
//
// Toast copy is localized via game.i18n; mapping table is below.

import { GmhubApiError } from "./api-client.js";

function localize(key, vars) {
  return vars ? game.i18n.format(key, vars) : game.i18n.localize(key);
}

export function showFriendlyError(err) {
  if (!(err instanceof GmhubApiError)) {
    console.error("[gmhub-vtt] non-GmhubApiError surfaced", err);
    ui.notifications.error(localize("GMHUB.Error.Generic", { message: err?.message ?? "unknown" }));
    return;
  }

  const status = err.status;
  const reason = err.body?.reason ?? "";

  if (status === 401 && reason === "missing_credentials") {
    ui.notifications.warn(localize("GMHUB.Error.401.MissingCredentials"));
    return;
  }
  if (status === 401) {
    ui.notifications.warn(localize("GMHUB.Error.401"));
    return;
  }
  if (status === 403 && reason === "missing_scope") {
    ui.notifications.warn(
      localize("GMHUB.Error.403", { scope: err.body?.scope ?? "(unknown)" })
    );
    return;
  }
  if (status === 403) {
    ui.notifications.warn(localize("GMHUB.Error.403.Generic"));
    return;
  }
  if (status === 409 && reason === "single_active_session") {
    ui.notifications.warn(localize("GMHUB.Error.409.single_active_session"));
    return;
  }
  if (status === 409 && reason === "session_ended") {
    ui.notifications.warn(localize("GMHUB.Error.409.session_ended"));
    return;
  }
  if (status === 409) {
    ui.notifications.warn(localize("GMHUB.Error.409.Generic"));
    return;
  }
  if (status === 429) {
    ui.notifications.warn(
      localize("GMHUB.Error.429", { seconds: err.body?.retryAfter ?? 60 })
    );
    return;
  }
  if (status >= 500) {
    ui.notifications.error(localize("GMHUB.Error.5xx"));
    return;
  }
  ui.notifications.error(
    localize("GMHUB.Error.Generic", {
      message: err.body?.message ?? err.body?.error ?? `HTTP ${status}`
    })
  );
}

// Wrap a fetch-shaped call so every failure routes through showFriendlyError.
// Re-throws so callers can still react (e.g. abort a sync loop). The ui.js
// dialog catches the re-thrown error and updates its inline output panel.
export async function safeCall(fn) {
  try {
    return await fn();
  } catch (err) {
    showFriendlyError(err);
    throw err;
  }
}

// Build the inline-output text for the Test Connection button.
// Returns a string ready to drop into the <pre data-role="sync-output">.
export function describePingResult(principal) {
  const scopes = Array.isArray(principal?.scopes) ? principal.scopes : [];
  const lines = [
    `✓ ${localize("GMHUB.Notify.PingOk", { userId: principal?.user_id ?? "?" })}`,
    `  scopes: ${scopes.join(", ") || "(none)"}`
  ];
  if (!scopes.includes("sessions:secrets")) {
    lines.push(`⚠ ${localize("GMHUB.Warn.NoSessionsSecrets")}`);
  }
  return lines.join("\n");
}

export function describePingFailure(err) {
  if (err instanceof GmhubApiError) {
    return `✗ HTTP ${err.status} ${err.body?.reason ?? err.body?.error ?? "unknown"}`;
  }
  return `✗ ${err?.message ?? "unknown error"}`;
}
