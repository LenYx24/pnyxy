/**
 * Lightweight client-error capture for the pilot: window error /
 * unhandledrejection listeners, the router's error boundary, and the
 * one-click "report a problem" flow all funnel through
 * `reportClientError` into the `client_errors` table (migration
 * 00076). Best-effort and content-free: only the error message,
 * stack, route, and small structured data ever get sent, never
 * message/document content.
 *
 * Consent: auto-captured 'crash'/'error' reports respect the same
 * gate as telemetry.ts (`profiles.preferences.consent_research_at`),
 * since they fire without the user asking. A 'report' is always sent
 * regardless of that gate: the user explicitly triggered it, the same
 * way FeedbackPrompt's send is never gated on research consent.
 */
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export type ClientErrorKind = "crash" | "error" | "report";

export interface ReportClientErrorInput {
  kind: ClientErrorKind;
  message: string;
  route?: string;
  context?: Record<string, unknown>;
}

export interface RecentClientError {
  kind: ClientErrorKind;
  message: string;
  route?: string;
  at: string;
}

const MAX_AUTO_REPORTS_PER_SESSION = 10;
const DEDUPE_WINDOW_MS = 30_000;
const RING_BUFFER_SIZE = 5;
const MESSAGE_MAX_LEN = 2000;
const STACK_MAX_LEN = 4000;

let autoReportCount = 0;
const lastSentAt = new Map<string, number>();
const ringBuffer: RecentClientError[] = [];

function pushRing(entry: RecentClientError): void {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();
}

/** Last few errors captured this session (any kind), most recent last.
 *  Used by the bug-report modal to attach "what just happened". */
export function getRecentClientErrors(): RecentClientError[] {
  return [...ringBuffer];
}

function consentBlocked(): boolean {
  const { profile } = useAuthStore.getState();
  const consentAt = (profile?.preferences as Record<string, unknown> | undefined)
    ?.consent_research_at;
  return consentAt === false;
}

/** Best-effort insert into client_errors. Never throws; swallows its own
 *  failure (a broken reporter must not break the app it's reporting on). */
export async function reportClientError(input: ReportClientErrorInput): Promise<void> {
  const message = input.message.slice(0, MESSAGE_MAX_LEN);
  const route =
    input.route ?? (typeof window !== "undefined" ? window.location.pathname : undefined);

  pushRing({ kind: input.kind, message, route, at: new Date().toISOString() });

  if (input.kind !== "report") {
    if (consentBlocked()) return;
    if (autoReportCount >= MAX_AUTO_REPORTS_PER_SESSION) return;
    const last = lastSentAt.get(message);
    const now = Date.now();
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
    lastSentAt.set(message, now);
    autoReportCount += 1;
  }

  try {
    const { user } = useAuthStore.getState();
    const { error } = await supabase.from("client_errors").insert({
      user_id: user?.id ?? null,
      kind: input.kind,
      message,
      route,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      context: input.context ?? null,
    });
    if (error && import.meta.env.DEV) {
      console.warn("client error report failed:", error.message);
    }
  } catch {
    // swallow: reporting must never itself throw
  }
}

let installed = false;

/** Install the window-level crash/error listeners once at app boot. */
export function installGlobalErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const err = event.error;
    const message =
      err instanceof Error
        ? err.message
        : typeof event.message === "string" && event.message
          ? event.message
          : "Unknown error";
    void reportClientError({
      kind: "crash",
      message,
      context: {
        stack: err instanceof Error ? err.stack?.slice(0, STACK_MAX_LEN) : undefined,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled rejection";
    // pdf.js throws this when a <Document> unmounts mid-load; main.tsx
    // already suppresses the console noise for it, don't report it too.
    if (message.includes("Worker was terminated")) return;
    void reportClientError({
      kind: "error",
      message,
      context: {
        stack: reason instanceof Error ? reason.stack?.slice(0, STACK_MAX_LEN) : undefined,
      },
    });
  });
}
