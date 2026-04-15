/**
 * Tauri platform detection and utilities.
 *
 * Usage:
 *   import { isTauri, invoke } from "@/lib/tauri";
 *
 *   if (isTauri) {
 *     const greeting = await invoke<string>("greet", { name: "World" });
 *   }
 */

/** True when the app is running inside a Tauri webview (desktop or mobile). */
export const isTauri: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Call a Rust command. Only works inside Tauri; throws in a regular browser.
 * Re-exports the Tauri invoke so callers don't need a direct dependency.
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}
