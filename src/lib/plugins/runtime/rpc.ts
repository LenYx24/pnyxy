/**
 * Minimal JSON-RPC envelope shared by the sandboxed runtime (and any
 * future runtime that needs cross-context calls). Methods are dotted
 * paths into `PluginAPI` (e.g. "storage.get"), arguments are an
 * array, results and errors are JSON-only.
 */

export interface RpcRequest {
  type: "rpc:req";
  id: number;
  method: string;
  args: unknown[];
}

export interface RpcResponse {
  type: "rpc:res";
  id: number;
  ok: boolean;
  /** Present when ok=true. */
  result?: unknown;
  /** Present when ok=false. */
  error?: { name: string; message: string };
}

/** Host → plugin: deliver a subscribed event. */
export interface RpcEvent {
  type: "rpc:event";
  subscriptionId: number;
  payload: unknown;
}

/** Host → plugin: invoke a command the plugin registered. */
export interface RpcCommand {
  type: "rpc:command";
  id: number;
  commandId: string;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcEvent | RpcCommand;

let nextRpcId = 1;
export function nextId(): number {
  return nextRpcId++;
}

export function makeRequest(method: string, args: unknown[]): RpcRequest {
  return { type: "rpc:req", id: nextId(), method, args };
}

export function makeResponse(
  id: number,
  ok: boolean,
  result: unknown,
  error?: { name: string; message: string },
): RpcResponse {
  return ok
    ? { type: "rpc:res", id, ok: true, result }
    : { type: "rpc:res", id, ok: false, error };
}

/** Promise that rejects after `ms` if not resolved first. */
export function timeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
