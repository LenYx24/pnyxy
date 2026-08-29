import { create } from "zustand";

/**
 * One pending "may the AI do this?" request at a time. A tool loop that
 * wants to run a write tool (create folder, move item, …) calls
 * `request()` and awaits the user's click on the approval card rendered
 * in the chat thread; approve/reject resolve the promise. Stopping the
 * stream rejects it so the loop can't hang.
 */
export interface PendingToolApproval {
  id: string;
  /** Tool name, for the card's icon/label lookup. */
  tool: string;
  /** Human summary of what would happen ("Create folder History/WW2"). */
  summary: string;
  /** Extra lines (e.g. items to move). */
  details?: string[];
}

interface ToolApprovalState {
  pending: PendingToolApproval | null;
  /** True while the user ticked "apply the rest without asking" this turn. */
  autoApprove: boolean;
  request: (req: Omit<PendingToolApproval, "id">) => Promise<boolean>;
  approve: (all?: boolean) => void;
  reject: () => void;
  /** Called when a turn ends: clears the auto-approve grant. */
  endTurn: () => void;
}

let resolver: ((ok: boolean) => void) | null = null;

export const useToolApprovalStore = create<ToolApprovalState>((set, get) => ({
  pending: null,
  autoApprove: false,

  request(req) {
    if (get().autoApprove) return Promise.resolve(true);
    // a stale request (loop aborted without answering) is rejected first
    resolver?.(false);
    return new Promise<boolean>((resolve) => {
      resolver = resolve;
      set({
        pending: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...req,
        },
      });
    });
  },

  approve(all = false) {
    const r = resolver;
    resolver = null;
    set({ pending: null, ...(all ? { autoApprove: true } : {}) });
    r?.(true);
  },

  reject() {
    const r = resolver;
    resolver = null;
    set({ pending: null });
    r?.(false);
  },

  endTurn() {
    const r = resolver;
    resolver = null;
    set({ pending: null, autoApprove: false });
    r?.(false);
  },
}));
