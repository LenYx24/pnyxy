/**
 * Sentry error monitoring for the pilot. Deliberately thin and
 * privacy-consistent with the rest of the app:
 *
 *  - Inert without a DSN. `VITE_SENTRY_DSN` is unset in local dev and
 *    until ops adds it, so `initSentry()` is a no-op there and no
 *    `@sentry/react` network traffic happens.
 *  - Single capture path. We drop Sentry's own automatic global error
 *    handlers and instead forward events from `reportClientError`
 *    (error-report.ts), so every Sentry event inherits the SAME
 *    research-consent gate, per-session rate limit, and content-free
 *    shape (message + stack + route only) as the `client_errors` table.
 *    That avoids a second, ungated path that would double-report and
 *    bypass consent.
 *  - Errors only. No performance tracing (`tracesSampleRate: 0`) and no
 *    default PII, to keep the free tier honest and the data minimal.
 */
import * as Sentry from "@sentry/react";
import type { ClientErrorKind } from "@/lib/error-report";

let enabled = false;

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return; // no DSN -> stay inert (local dev, or before ops sets it)

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_APP_VERSION as string | undefined) || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Remove Sentry's own uncaught-error/rejection handlers: we capture
    // explicitly from reportClientError so consent + rate-limit + the
    // content-free shape are applied first. Filtering by name is
    // tolerant if a future SDK renames these (worst case: a handler
    // stays on, which is harmless double-capture, never a crash).
    integrations: (defaults) =>
      defaults.filter(
        (i) => i.name !== "GlobalHandlers" && i.name !== "BrowserApiErrors",
      ),
  });
  enabled = true;
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Forward an already-gated client error to Sentry. Called from
 * reportClientError AFTER its consent/rate-limit/dedupe checks pass, so
 * this never sends anything the app wouldn't also write to client_errors.
 */
export function captureToSentry(
  message: string,
  kind: ClientErrorKind,
  context?: Record<string, unknown>,
): void {
  if (!enabled) return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag("kind", kind);
      if (context) scope.setContext("pnyxy", context);
      const stack = context?.stack;
      if (typeof stack === "string" && stack) {
        // Rebuild an Error so Sentry groups by stack, not by message.
        const err = new Error(message);
        err.stack = stack;
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(message, kind === "report" ? "info" : "error");
      }
    });
  } catch {
    // a broken reporter must never break the app it reports on
  }
}
