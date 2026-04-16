export function logError(context: string, error: unknown) {
  if (import.meta.env.DEV) {
    console.error(`[${context}]`, error);
  }
}

export function logWarn(context: string, message: string, data?: unknown) {
  if (import.meta.env.DEV) {
    console.warn(`[${context}]`, message, data ?? "");
  }
}
