import type { HostEventName, HostEvents } from "../types";

type Listener<K extends HostEventName> = (payload: HostEvents[K]) => void;

/**
 * Tiny pub/sub used by the host to broadcast reader/book events to
 * loaded plugins. Listeners receive the JSON payload directly; the
 * runtime wraps each subscription so the plugin only sees the
 * payload, never the listener function reference.
 */
export class HostEventBus {
  private readonly listeners = new Map<HostEventName, Set<Listener<HostEventName>>>();

  emit<K extends HostEventName>(name: K, payload: HostEvents[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        // A misbehaving plugin listener must not break the host.
        console.error(`[plugin] listener for "${name}" threw:`, err);
      }
    }
  }

  on<K extends HostEventName>(name: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn as Listener<HostEventName>);
    return () => {
      set!.delete(fn as Listener<HostEventName>);
    };
  }
}

/** Singleton bus shared by reader-store emitters and the plugin host. */
export const hostEventBus = new HostEventBus();
