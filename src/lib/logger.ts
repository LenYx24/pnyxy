/**
 * True for errors that are recoverable and unactionable from app
 * code, typically navigator.locks coordination races in dev mode
 * (React StrictMode + Supabase gotrue-js's auth-token lock). The
 * SDK already retries internally, so the message is noise. Filtering
 * these out of `logError` keeps the dev console focused on real
 * problems without losing signal in production (where `logError`
 * only runs when `import.meta.env.DEV` is true anyway).
 */
function isLockNoise(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name !== "AbortError") return false;
  return error.message.includes("Lock broken by another request");
}

export function logError(context: string, error: unknown) {
  if (isLockNoise(error)) return;
  // Also logs in production: a silent error path is worse than a console
  // line. A remote sink can hook in here later.
  console.error(`[${context}]`, error);
}

export function logWarn(context: string, message: string, data?: unknown) {
  if (import.meta.env.DEV) {
    console.warn(`[${context}]`, message, data ?? "");
  }
}
