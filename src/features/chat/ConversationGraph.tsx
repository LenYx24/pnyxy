import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Maximize2 } from "lucide-react";
import { pathFromRoot, useChatStore } from "@/stores/chat-store";
import type { ChatConversation, ChatMessage } from "@/types/chat";

/**
 * Obsidian-style force-directed graph of the user's conversations, with
 * a drill-down INNER view of a single conversation's message tree.
 *
 * Conversations view (document-rooted tree):
 *   - Each unique source document is a ROOT node (or, when `scopeDocId`
 *     is set (the reader's open book), the graph is filtered to just
 *     that document's conversations).
 *   - A conversation grounded in a document hangs off it; a forked
 *     conversation (parent_conversation_id) nests under its PARENT
 *     conversation; a standalone chat is its own free root.
 *   - Double-click a conversation → enter the MESSAGE view.
 *
 * Message view (one conversation):
 *   - Each node is a message; edges follow `parent_message_id`, so
 *     in-conversation BRANCHES fan out visibly. The active root→leaf
 *     path is highlighted.
 *   - Right-click a message for a context menu: continue the
 *     conversation from there, branch it into a new conversation, or
 *     delete from there.
 *
 * Rendered on <canvas> with a hand-rolled d3-style force sim (no graph
 * dep): repulsion + link springs + centering, alpha cooldown.
 */

interface GraphNode {
  id: string;
  kind: "doc" | "conv" | "msg";
  label: string;
  role?: "user" | "assistant" | "system";
  onPath?: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}
interface GraphLink {
  source: string;
  target: string;
}

const CHARGE = 2600;
const LINK_DIST = 92;
const LINK_STRENGTH = 0.06;
const CENTER = 0.015;
const VELOCITY_DECAY = 0.6;
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.006;

interface Colors {
  accent: string;
  text: string;
  muted: string;
  node: string;
  border: string;
  bg: string;
}

function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const g = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    accent: g("--color-accent", "#0891b2"),
    text: g("--color-text-primary", "#eaf2ff"),
    muted: g("--color-text-muted", "#b0bbd8"),
    node: g("--color-bg-tertiary", "#1a1a24"),
    border: g("--color-glass-border", "rgba(255,255,255,0.14)"),
    bg: g("--color-bg-primary", "#0a0a0f"),
  };
}

function seed(
  id: string,
  kind: GraphNode["kind"],
  label: string,
  i: number,
): GraphNode {
  const a = i * 2.399963;
  const rad = 24 + i * 6;
  return {
    id,
    kind,
    label,
    x: Math.cos(a) * rad,
    y: Math.sin(a) * rad,
    vx: 0,
    vy: 0,
    r: kind === "doc" ? 9 : kind === "msg" ? 5 : 5.5,
  };
}

function buildConversationGraph(
  conversations: ChatConversation[],
  scopeDocId: string | null | undefined,
): { nodes: GraphNode[]; links: GraphLink[] } {
  // When scoped to a book, only that book's conversations (forks copy
  // the source_doc_id, so this catches them too).
  const list = scopeDocId
    ? conversations.filter((c) => c.source_doc_id === scopeDocId)
    : conversations;
  const convIds = new Set(list.map((c) => c.id));
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const docSeen = new Set<string>();

  for (const c of list) {
    if (c.source_doc_id && !docSeen.has(c.source_doc_id)) {
      docSeen.add(c.source_doc_id);
      nodes.push(
        seed(`doc:${c.source_doc_id}`, "doc", c.source_doc_title || "Document", nodes.length),
      );
    }
  }
  for (const c of list) {
    nodes.push(seed(c.id, "conv", c.title || "Untitled", nodes.length));
  }
  for (const c of list) {
    if (c.parent_conversation_id && convIds.has(c.parent_conversation_id)) {
      links.push({ source: c.id, target: c.parent_conversation_id });
    } else if (c.source_doc_id) {
      links.push({ source: c.id, target: `doc:${c.source_doc_id}` });
    }
  }
  return { nodes, links };
}

function buildMessageGraph(
  messages: Map<string, ChatMessage>,
  activeLeafId: string | null,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const onPath = new Set(
    activeLeafId ? pathFromRoot(messages, activeLeafId).map((m) => m.id) : [],
  );
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  let i = 0;
  for (const m of messages.values()) {
    const text = m.content.replace(/\s+/g, " ").trim();
    const n = seed(m.id, "msg", text || `(${m.role})`, i++);
    n.role = m.role;
    n.onPath = onPath.has(m.id);
    nodes.push(n);
  }
  for (const m of messages.values()) {
    if (m.parent_message_id && messages.has(m.parent_message_id)) {
      links.push({ source: m.id, target: m.parent_message_id });
    }
  }
  return { nodes, links };
}

interface MenuState {
  x: number;
  y: number;
  nodeId: string;
  kind: GraphNode["kind"];
}

export function ConversationGraph({
  onOpen,
  scopeDocId,
  className,
}: {
  onOpen?: (conversationId: string) => void;
  /** Restrict the conversations view to one document (reader panel). */
  scopeDocId?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const messages = useChatStore((s) => s.messages);
  const activeLeafId = useChatStore((s) => s.activeLeafId);
  const storeOpenConversation = useChatStore((s) => s.openConversation);
  const setActiveLeaf = useChatStore((s) => s.setActiveLeaf);
  const duplicateFromMessage = useChatStore((s) => s.duplicateFromMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);

  // "conversations" = the doc-rooted map; "messages" = one conversation's
  // message tree (focusConvId).
  const [mode, setMode] = useState<"conversations" | "messages">("conversations");
  const [focusConvId, setFocusConvId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );

  const focusTitle = useMemo(
    () => conversations.find((c) => c.id === focusConvId)?.title || "Untitled",
    [conversations, focusConvId],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const nodeById = useRef<Map<string, GraphNode>>(new Map());
  const camRef = useRef({ x: 0, y: 0, k: 1 });
  const alphaRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const colorsRef = useRef<Colors | null>(null);
  const hoverRef = useRef<string | null>(null);
  const activeRef = useRef<string | null>(activeId);
  activeRef.current = activeId;
  const clickTimerRef = useRef<number | null>(null);

  const dragNodeRef = useRef<GraphNode | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const downRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const [empty, setEmpty] = useState(false);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const cam = camRef.current;
    return { x: (sx - cam.x) / cam.k, y: (sy - cam.y) / cam.k };
  }, []);

  const nodeAt = useCallback(
    (sx: number, sy: number): GraphNode | null => {
      const w = screenToWorld(sx, sy);
      const cam = camRef.current;
      let best: GraphNode | null = null;
      let bestD = Infinity;
      for (const n of nodesRef.current) {
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        if (d <= n.r + 6 / cam.k && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    },
    [screenToWorld],
  );

  // Rebuild the graph when its inputs change, preserving positions.
  useEffect(() => {
    const prev = nodeById.current;
    const { nodes, links } =
      mode === "messages"
        ? buildMessageGraph(messages, activeLeafId)
        : buildConversationGraph(conversations, scopeDocId);
    for (const n of nodes) {
      const old = prev.get(n.id);
      if (old) {
        n.x = old.x;
        n.y = old.y;
        n.vx = old.vx;
        n.vy = old.vy;
      }
    }
    nodesRef.current = nodes;
    linksRef.current = links;
    nodeById.current = new Map(nodes.map((n) => [n.id, n]));
    setEmpty(nodes.length === 0);
    alphaRef.current = 0.9;
    ensureRunning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, messages, activeLeafId, mode, scopeDocId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const colors = colorsRef.current;
    if (!canvas || !colors) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const cam = camRef.current;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.k, cam.k);

    ctx.lineWidth = 1 / cam.k;
    ctx.strokeStyle = colors.border;
    for (const l of linksRef.current) {
      const s = nodeById.current.get(l.source);
      const tt = nodeById.current.get(l.target);
      if (!s || !tt) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tt.x, tt.y);
      ctx.stroke();
    }

    const hover = hoverRef.current;
    const active = activeRef.current;
    const inMsg = mode === "messages";
    for (const n of nodesRef.current) {
      const highlight =
        inMsg ? !!n.onPath : n.id === active;
      const isHover = n.id === hover;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      if (n.kind === "doc" || highlight) ctx.fillStyle = colors.accent;
      else if (n.kind === "msg" && n.role === "user") ctx.fillStyle = colors.muted;
      else ctx.fillStyle = colors.node;
      ctx.fill();
      ctx.lineWidth = (highlight || isHover ? 2 : 1) / cam.k;
      ctx.strokeStyle =
        highlight || isHover || n.kind === "doc" ? colors.accent : colors.border;
      ctx.stroke();

      const showLabel =
        n.kind === "doc" || highlight || isHover || cam.k >= 1.15;
      if (showLabel) {
        const fontPx = (n.kind === "doc" ? 12 : 11) / cam.k;
        ctx.font = `${fontPx}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = highlight || isHover ? colors.text : colors.muted;
        const raw =
          inMsg && n.role
            ? `${n.role === "user" ? "You" : n.role === "assistant" ? "AI" : "Sys"}: ${n.label}`
            : n.label;
        const label = raw.length > 28 ? raw.slice(0, 27) + "…" : raw;
        ctx.fillText(label, n.x, n.y + n.r + 3 / cam.k);
      }
    }
    ctx.restore();
  }, [mode]);

  const tick = useCallback(() => {
    const nodes = nodesRef.current;
    const links = linksRef.current;
    let alpha = alphaRef.current;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (Math.random() - 0.5) * 0.1;
          dy = (Math.random() - 0.5) * 0.1;
          d2 = dx * dx + dy * dy + 0.01;
        }
        const d = Math.sqrt(d2);
        const f = (CHARGE * alpha) / d2;
        a.vx -= (dx / d) * f;
        a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f;
        b.vy += (dy / d) * f;
      }
    }
    for (const l of links) {
      const s = nodeById.current.get(l.source);
      const tt = nodeById.current.get(l.target);
      if (!s || !tt) continue;
      const dx = tt.x - s.x;
      const dy = tt.y - s.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - LINK_DIST) * LINK_STRENGTH * alpha;
      s.vx += (dx / d) * f;
      s.vy += (dy / d) * f;
      tt.vx -= (dx / d) * f;
      tt.vy -= (dy / d) * f;
    }
    const drag = dragNodeRef.current;
    for (const n of nodes) {
      if (n === drag) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx += (0 - n.x) * CENTER * alpha;
      n.vy += (0 - n.y) * CENTER * alpha;
      n.vx *= VELOCITY_DECAY;
      n.vy *= VELOCITY_DECAY;
      n.x += n.vx;
      n.y += n.vy;
    }

    alpha *= ALPHA_DECAY;
    alphaRef.current = alpha;
    draw();
    if (alpha > ALPHA_MIN || dragNodeRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
    }
  }, [draw]);

  const ensureRunning = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    colorsRef.current = readColors(wrap);
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      camRef.current.x = r.width / 2;
      camRef.current.y = r.height / 2;
      colorsRef.current = readColors(wrap);
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    ensureRunning();
    return () => {
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
  }, [activeId, draw]);

  // Fit all nodes into view (recenter + zoom to bounds).
  const fitView = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    const { w, h } = sizeRef.current;
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const pad = 48;
    const k = Math.max(
      0.2,
      Math.min(3, (w - pad * 2) / bw, (h - pad * 2) / bh),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camRef.current.k = k;
    camRef.current.x = w / 2 - cx * k;
    camRef.current.y = h / 2 - cy * k;
    draw();
  }, [draw]);

  // Auto-fit shortly after the view changes (once the sim has mostly
  // settled), so switching into the message tree frames it nicely.
  useEffect(() => {
    const id = window.setTimeout(fitView, 650);
    return () => window.clearTimeout(id);
  }, [mode, focusConvId, fitView]);

  const enterMessageView = useCallback(
    (convId: string) => {
      void storeOpenConversation(convId); // loads its messages into the store
      setFocusConvId(convId);
      setMode("messages");
      setMenu(null);
    },
    [storeOpenConversation],
  );

  // ── Pointer handlers ────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    setMenu(null);
    setTooltip(null);
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    downRef.current = { x: sx, y: sy, moved: false };
    const hit = nodeAt(sx, sy);
    if (hit) {
      dragNodeRef.current = hit;
      alphaRef.current = Math.max(alphaRef.current, 0.4);
      ensureRunning();
    } else {
      panRef.current = { x: sx - camRef.current.x, y: sy - camRef.current.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const down = downRef.current;
    if (down && !down.moved && Math.hypot(sx - down.x, sy - down.y) > 4) {
      down.moved = true;
    }
    const drag = dragNodeRef.current;
    if (drag) {
      const w = screenToWorld(sx, sy);
      drag.x = w.x;
      drag.y = w.y;
      ensureRunning();
      return;
    }
    if (panRef.current) {
      camRef.current.x = sx - panRef.current.x;
      camRef.current.y = sy - panRef.current.y;
      draw();
      return;
    }
    const hit = nodeAt(sx, sy);
    const id = hit?.id ?? null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      canvasRef.current!.style.cursor = hit ? "pointer" : "grab";
      if (hit) {
        const cam = camRef.current;
        const prefix =
          hit.role === "user" ? "You: " : hit.role === "assistant" ? "AI: " : "";
        setTooltip({
          x: hit.x * cam.k + cam.x,
          y: hit.y * cam.k + cam.y - hit.r * cam.k - 8,
          text: `${prefix}${hit.label}`,
        });
      } else {
        setTooltip(null);
      }
      draw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const down = downRef.current;
    const drag = dragNodeRef.current;
    dragNodeRef.current = null;
    panRef.current = null;
    downRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // storage unavailable (private mode / quota); the default takes over
    }
    alphaRef.current = Math.max(alphaRef.current, 0.02);
    if (!down || down.moved || !drag) return;

    // Single click. Defer so a double-click (drill-in) can cancel it.
    if (mode === "conversations" && drag.kind === "conv") {
      const id = drag.id;
      if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        onOpen?.(id);
      }, 220);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (clickTimerRef.current != null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    const rect = canvasRef.current!.getBoundingClientRect();
    const hit = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    if (mode === "conversations" && hit.kind === "conv") {
      enterMessageView(hit.id);
    } else if (mode === "messages" && hit.kind === "msg" && focusConvId) {
      // quick "continue from here"
      void setActiveLeaf(hit.id).then(() => onOpen?.(focusConvId));
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const hit = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit || hit.kind === "doc") {
      setMenu(null);
      return;
    }
    setMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      nodeId: hit.id,
      kind: hit.kind,
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const cam = camRef.current;
    const k2 = Math.max(0.2, Math.min(4, cam.k * Math.exp(-e.deltaY * 0.0015)));
    cam.x = sx - ((sx - cam.x) * k2) / cam.k;
    cam.y = sy - ((sy - cam.y) * k2) / cam.k;
    cam.k = k2;
    draw();
  };

  // Context-menu actions.
  const menuItems = useMemo(() => {
    if (!menu) return [];
    if (menu.kind === "conv") {
      return [
        { label: t("chat.graph.open", { defaultValue: "Open" }), run: () => onOpen?.(menu.nodeId) },
        {
          label: t("chat.graph.messageView", { defaultValue: "Message view" }),
          run: () => enterMessageView(menu.nodeId),
        },
      ];
    }
    // message node
    return [
      {
        label: t("chat.graph.continueHere", { defaultValue: "Continue from here" }),
        run: async () => {
          await setActiveLeaf(menu.nodeId);
          if (focusConvId) onOpen?.(focusConvId);
        },
      },
      {
        label: t("chat.graph.branchHere", { defaultValue: "New conversation from here" }),
        run: async () => {
          const nid = await duplicateFromMessage(menu.nodeId);
          if (nid) onOpen?.(nid);
        },
      },
      {
        label: t("chat.graph.deleteHere", { defaultValue: "Delete from here" }),
        danger: true,
        run: () => deleteMessage(menu.nodeId),
      },
    ];
  }, [menu, t, onOpen, enterMessageView, setActiveLeaf, focusConvId, duplicateFromMessage, deleteMessage]);

  return (
    <div ref={wrapRef} className={className} style={{ position: "relative" }}>
      {mode === "messages" && (
        <div className="absolute left-2 top-2 z-10 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("conversations");
              setMenu(null);
            }}
            className="flex items-center gap-1 rounded-md border border-glass-border bg-bg-secondary/80 px-2 py-1 text-xs text-text-secondary backdrop-blur-md transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <ArrowLeft size={13} />
            {t("chat.graph.back", { defaultValue: "Back" })}
          </button>
          <span className="max-w-[50vw] truncate rounded-md bg-glass-bg px-2 py-1 text-xs text-text-muted">
            {focusTitle}
          </span>
        </div>
      )}

      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        style={{ display: "block", touchAction: "none", cursor: "grab" }}
      />

      <button
        type="button"
        onClick={fitView}
        title={t("chat.graph.fit", { defaultValue: "Fit to view" })}
        aria-label={t("chat.graph.fit", { defaultValue: "Fit to view" })}
        className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-md border border-glass-border bg-bg-secondary/80 text-text-muted backdrop-blur-md transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      >
        <Maximize2 size={14} />
      </button>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 max-w-[16rem] -translate-x-1/2 -translate-y-full rounded-md border border-glass-border bg-bg-secondary px-2 py-1 text-xs text-text-secondary shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <span className="line-clamp-3">{tooltip.text}</span>
        </div>
      )}

      {menu && (
        <div
          className="absolute z-20 min-w-[11rem] overflow-hidden rounded-lg border border-glass-border bg-bg-secondary shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          {menuItems.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setMenu(null);
                void it.run();
              }}
              className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors cursor-pointer hover:bg-glass-hover ${
                "danger" in it && it.danger
                  ? "text-danger"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-text-muted">
          {mode === "messages"
            ? t("chat.graph.emptyMessages", { defaultValue: "No messages in this conversation yet." })
            : t("chat.graph.empty", {
                defaultValue: "No conversations yet, start chatting and they'll appear here.",
              })}
        </div>
      )}
    </div>
  );
}
