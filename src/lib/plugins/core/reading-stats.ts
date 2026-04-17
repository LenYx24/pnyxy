import type { HostEvents, PluginAPI, PluginManifest, PluginModule } from "../types";

export const readingStatsManifest: PluginManifest = {
  id: "reading-stats",
  name: "Reading Stats",
  version: "1.0.0",
  apiVersion: 1,
  author: "Pnyxy",
  description:
    "Tracks how many unique pages you read per document during each session. Use the \"Reading Stats: Show this session\" command to see your stats. Stats reset when you reload the page.",
  entry: "",
  permissions: ["storage", "events:reader", "commands"],
  runtime: ["sandboxed"],
};

interface SessionState {
  visitedPages: Map<string, Set<number>>;
}

export function createReadingStatsModule(): PluginModule {
  let api: PluginAPI | null = null;
  let pageSubId: number | null = null;
  const session: SessionState = { visitedPages: new Map() };

  const handlers = new Map<string, () => Promise<void>>();
  const eventHandlers = new Map<number, (payload: unknown) => void>();

  return {
    async onLoad(pluginApi) {
      api = pluginApi;

      // Subscribe to reader page changes.
      pageSubId = await api.events.on("reader:page-change");
      eventHandlers.set(pageSubId, (raw) => {
        const payload = raw as HostEvents["reader:page-change"];
        let set = session.visitedPages.get(payload.docId);
        if (!set) {
          set = new Set();
          session.visitedPages.set(payload.docId, set);
        }
        set.add(payload.page);
      });

      // Register a "show stats" command.
      await api.commands.register(
        "reading-stats:show",
        "Reading Stats: Show this session",
      );
      handlers.set("reading-stats:show", async () => {
        if (!api) return;
        const lines: string[] = [];
        for (const [docId, set] of session.visitedPages) {
          lines.push(`${docId}: ${set.size} unique page(s)`);
        }
        const message = lines.length === 0
          ? "No pages tracked yet this session."
          : lines.join("\n");
        // Notification permission is optional for this plugin; if it
        // wasn't granted we just log to console.
        try {
          await api.notifications.show(message);
        } catch {
          console.info("[reading-stats]", message);
        }
      });
    },

    async onUnload() {
      if (api && pageSubId != null) {
        try {
          await api.events.off(pageSubId);
        } catch {
          // ignore
        }
      }
      session.visitedPages.clear();
      handlers.clear();
      eventHandlers.clear();
      api = null;
      pageSubId = null;
    },

    handleEvent(subscriptionId, payload) {
      const fn = eventHandlers.get(subscriptionId);
      fn?.(payload);
    },

    async handleCommand(id) {
      const fn = handlers.get(id);
      if (fn) await fn();
    },
  };
}
