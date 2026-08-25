import type { Ref } from "react";

/** Forward a DOM node to a caller-supplied ref (callback or object). */
export function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === "function") {
    ref(node);
  } else if (ref && typeof ref === "object") {
    (ref as { current: T | null }).current = node;
  }
}
