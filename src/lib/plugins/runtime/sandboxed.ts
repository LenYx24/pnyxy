import type { PluginAPI, PluginManifest } from "../types";
import {
  makeResponse,
  type RpcCommand,
  type RpcEvent,
  type RpcMessage,
  type RpcRequest,
  timeout,
} from "./rpc";
import type { PluginHandle, PluginRuntime } from "./types";

const HANDSHAKE_TIMEOUT_MS = 5000;
const RPC_TIMEOUT_MS = 10000;

/**
 * srcdoc bootstrap. The iframe creates a global `plugin` object that
 * proxies `PluginAPI` calls over MessageChannel using JSON-RPC. The
 * host injects the plugin bundle as inline `<script>` text via the
 * `run` message, required because `sandbox="allow-scripts"` without
 * `allow-same-origin` gives the iframe an opaque origin and forbids
 * cross-origin `fetch`.
 */
const SANDBOX_HTML = `<!doctype html><meta charset="utf-8"><script>
(function () {
  var port = null;
  var pendingRpcId = 1;
  var pending = Object.create(null); // id -> {resolve, reject}
  var subscriptions = Object.create(null); // subId -> handler
  var commandHandlers = Object.create(null); // commandId -> handler
  var pluginModule = null;

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = pendingRpcId++;
      pending[id] = { resolve: resolve, reject: reject };
      port.postMessage({ type: 'rpc:req', id: id, method: method, args: args || [] });
    });
  }

  function makeApi() {
    var on = function (name) {
      return call('events.on', [name]).then(function (subId) {
        return {
          subscriptionId: subId,
          off: function () { return call('events.off', [subId]); },
          onEvent: function (handler) { subscriptions[subId] = handler; }
        };
      });
    };
    return {
      app: { version: null }, // populated post-handshake
      commands: {
        register: function (id, label) {
          return call('commands.register', [id, label]);
        },
        execute: function (id) { return call('commands.execute', [id]); },
        on: function (id, handler) { commandHandlers[id] = handler; }
      },
      storage: {
        get: function (k) { return call('storage.get', [k]); },
        set: function (k, v) { return call('storage.set', [k, v]); },
        remove: function (k) { return call('storage.remove', [k]); },
        keys: function () { return call('storage.keys', []); }
      },
      notifications: {
        show: function (msg) { return call('notifications.show', [msg]); }
      },
      events: { on: on, off: function (id) { return call('events.off', [id]); } }
    };
  }

  function handlePortMessage(ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'rpc:res') {
      var p = pending[msg.id]; delete pending[msg.id];
      if (!p) return;
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error((msg.error && msg.error.message) || 'rpc error'));
    } else if (msg.type === 'rpc:event') {
      var h = subscriptions[msg.subscriptionId];
      if (h) try { h(msg.payload); } catch (e) { console.error('[plugin] event handler threw', e); }
    } else if (msg.type === 'rpc:command') {
      var ch = commandHandlers[msg.commandId];
      Promise.resolve()
        .then(function () { return ch ? ch() : undefined; })
        .then(function () { port.postMessage({ type: 'rpc:res', id: msg.id, ok: true }); })
        .catch(function (e) { port.postMessage({ type: 'rpc:res', id: msg.id, ok: false, error: { name: e && e.name || 'Error', message: String(e && e.message || e) } }); });
    }
  }

  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'init' && Array.isArray(ev.ports) && ev.ports[0]) {
      port = ev.ports[0];
      port.onmessage = handlePortMessage;
      port.postMessage({ type: 'ready' });
    } else if (msg.type === 'run' && typeof msg.src === 'string') {
      try {
        var api = makeApi();
        api.app.version = msg.appVersion;
        var moduleObj = { exports: {} };
        var fn = new Function('module', 'exports', 'plugin', msg.src + '\\n;return (typeof onLoad === "function" ? { onLoad: onLoad, onUnload: typeof onUnload === "function" ? onUnload : undefined } : module.exports);');
        pluginModule = fn(moduleObj, moduleObj.exports, api) || moduleObj.exports;
        Promise.resolve()
          .then(function () { return pluginModule && pluginModule.onLoad ? pluginModule.onLoad(api, { manifest: msg.manifest }) : undefined; })
          .then(function () { window.parent.postMessage({ type: 'loaded' }, '*'); })
          .catch(function (e) { window.parent.postMessage({ type: 'load-error', message: String(e && e.message || e) }, '*'); });
      } catch (e) {
        window.parent.postMessage({ type: 'load-error', message: String(e && e.message || e) }, '*');
      }
    } else if (msg.type === 'unload') {
      Promise.resolve().then(function () { return pluginModule && pluginModule.onUnload ? pluginModule.onUnload() : undefined; });
    }
  });
})();
</script>`;

/**
 * Cross-origin iframe sandbox runtime. Uses `sandbox="allow-scripts"`
 * (no `allow-same-origin`) so the iframe gets an opaque origin -
 * cannot read host cookies/localStorage/IndexedDB nor make
 * same-origin fetches against Supabase. Communication goes through
 * a single MessagePort handshake; every inbound RPC is dispatched
 * through `buildHostApi` which enforces permissions host-side.
 */
export class SandboxedRuntime implements PluginRuntime {
  readonly kind = "sandboxed" as const;

  async load(opts: {
    manifest: PluginManifest;
    bundle: string | null;
    api: PluginAPI;
  }): Promise<PluginHandle> {
    const { manifest, bundle, api } = opts;
    if (!bundle) {
      throw new Error(
        `SandboxedRuntime requires a bundle string for plugin "${manifest.id}"`,
      );
    }

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "absolute";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.left = "-9999px";
    iframe.style.top = "-9999px";
    iframe.srcdoc = SANDBOX_HTML;
    document.body.appendChild(iframe);

    const channel = new MessageChannel();
    const hostPort = channel.port1;

    // Track pending RPCs initiated from host → plugin (commands).
    const pendingHostRpcs = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    const eventHandlers = new Map<number, (payload: unknown) => void>();

    // Wire up plugin → host RPC. Only messages from this iframe's
    // contentWindow are accepted (origin is opaque so we can't check
    // event.origin; rely on source identity instead).
    hostPort.onmessage = (event: MessageEvent<RpcMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "rpc:req") {
        void dispatch(msg);
      } else if (msg.type === "rpc:res") {
        const p = pendingHostRpcs.get(msg.id);
        if (!p) return;
        pendingHostRpcs.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error?.message ?? "plugin error"));
      }
    };
    hostPort.start();

    async function dispatch(req: RpcRequest): Promise<void> {
      try {
        const result = await invokeApi(api, req.method, req.args);
        hostPort.postMessage(makeResponse(req.id, true, result));
      } catch (err) {
        const e = err as Error;
        hostPort.postMessage(
          makeResponse(req.id, false, undefined, {
            name: e.name || "Error",
            message: e.message || String(err),
          }),
        );
      }
    }

    // Wait for srcdoc bootstrap to send a `ready` over the port,
    // gated by the parent-side handshake message which transfers the
    // port. Then post `run` with the bundle source.
    await timeout(
      new Promise<void>((resolve, reject) => {
        const onReadyOrError = (event: MessageEvent) => {
          if (event.source !== iframe.contentWindow) return;
          const data = event.data as { type?: string; message?: string } | null;
          if (!data || typeof data !== "object") return;
          if (data.type === "loaded") {
            window.removeEventListener("message", onReadyOrError);
            resolve();
          } else if (data.type === "load-error") {
            window.removeEventListener("message", onReadyOrError);
            reject(new Error(data.message ?? "plugin load failed"));
          }
        };
        const onPortReady = (event: MessageEvent<RpcMessage | { type: string }>) => {
          const data = event.data as { type?: string } | null;
          if (data && data.type === "ready") {
            hostPort.removeEventListener("message", onPortReady);
            // Fire `run` once the port is live.
            iframe.contentWindow?.postMessage(
              {
                type: "run",
                src: bundle,
                appVersion: api.app.version,
                manifest,
              },
              "*",
            );
          }
        };
        hostPort.addEventListener("message", onPortReady as EventListener);
        window.addEventListener("message", onReadyOrError);

        // Send the init handshake transferring port2 to the iframe.
        // contentWindow may not be ready synchronously after append;
        // wait for `load`.
        const sendInit = () => {
          iframe.contentWindow?.postMessage({ type: "init" }, "*", [
            channel.port2,
          ]);
        };
        if (iframe.contentDocument?.readyState === "complete") sendInit();
        else iframe.addEventListener("load", sendInit, { once: true });
      }),
      HANDSHAKE_TIMEOUT_MS,
      `plugin "${manifest.id}" handshake`,
    );

    return {
      manifest,
      async destroy() {
        try {
          iframe.contentWindow?.postMessage({ type: "unload" }, "*");
        } catch {
          // ignore
        }
        hostPort.close();
        iframe.remove();
        for (const p of pendingHostRpcs.values()) {
          p.reject(new Error("plugin unloaded"));
        }
        pendingHostRpcs.clear();
        eventHandlers.clear();
      },
      deliverEvent(subscriptionId, payload) {
        const ev: RpcEvent = {
          type: "rpc:event",
          subscriptionId,
          payload,
        };
        hostPort.postMessage(ev);
      },
      async invokeCommand(commandId) {
        const id = pendingHostRpcs.size + 1_000_000; // plenty of room
        const cmd: RpcCommand = {
          type: "rpc:command",
          id,
          commandId,
        };
        await timeout(
          new Promise<unknown>((resolve, reject) => {
            pendingHostRpcs.set(id, { resolve, reject });
            hostPort.postMessage(cmd);
          }),
          RPC_TIMEOUT_MS,
          `plugin "${manifest.id}" command "${commandId}"`,
        );
      },
    };
  }
}

/** Walk a dotted method path on `PluginAPI` and call it with `args`. */
async function invokeApi(
  api: PluginAPI,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const parts = method.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let obj: any = api;
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj?.[parts[i]];
    if (obj == null) throw new Error(`Unknown plugin API path: ${method}`);
  }
  const fn = obj[parts[parts.length - 1]];
  if (typeof fn !== "function") {
    throw new Error(`Unknown plugin API method: ${method}`);
  }
  return fn.apply(obj, args);
}
