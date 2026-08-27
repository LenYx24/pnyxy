/**
 * Left "Navigáció" tree of the Moodle-style course page: the user's
 * spaces hierarchy (mySpaces + the active space's ancestor chain),
 * collapsible per node, plus the active space's own sections as leaf
 * links that scroll the main column. State persisted in localStorage
 * (`pnyxy:spaces-nav-collapsed`); the open/rail state lives one level
 * up (CourseSpacePage owns `pnyxy:spaces-nav-open`).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useSpaceStore } from "@/stores/space-store";
import type { Space } from "@/types/space";

const NAV_COLLAPSED_KEY = "pnyxy:spaces-nav-collapsed";

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(NAV_COLLAPSED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>): void {
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // private mode: collapse state just won't persist
  }
}

interface TreeNode {
  space: Space;
  children: TreeNode[];
}

const NODE_ICON = (kind: Space["kind"]) =>
  kind === "org" || kind === "subspace" ? Building2 : GraduationCap;

export function CourseNavTree({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mySpaces = useSpaceStore((s) => s.mySpaces);
  const activeSpace = useSpaceStore((s) => s.activeSpace);
  const activeSpaceAncestors = useSpaceStore((s) => s.activeSpaceAncestors);
  const activeSpaceSections = useSpaceStore((s) => s.activeSpaceSections);

  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    readCollapsed(),
  );

  // Path from root to the active space: force-expanded (independent of
  // the persisted collapse set) so the current location is never
  // hidden behind a stale collapsed ancestor.
  const activePathIds = useMemo(() => {
    const ids = new Set(activeSpaceAncestors.map((a) => a.id));
    if (activeSpace) ids.add(activeSpace.id);
    return ids;
  }, [activeSpaceAncestors, activeSpace]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsed(next);
      return next;
    });
  };

  const roots = useMemo(() => {
    // Merge mySpaces with the active space's ancestor chain (linear,
    // root first) so a space the user is browsing but hasn't joined
    // still shows its full path.
    const byId = new Map<string, Space>();
    for (const sp of mySpaces) byId.set(sp.id, sp);
    let prevId: string | null = null;
    for (const anc of activeSpaceAncestors) {
      if (!byId.has(anc.id)) {
        byId.set(anc.id, {
          id: anc.id,
          name: anc.name,
          parent_id: prevId,
          owner_id: "",
          kind: "org",
          slug: null,
          description: null,
          visibility: "public",
          official: false,
          created_at: "",
          updated_at: "",
        });
      }
      prevId = anc.id;
    }
    if (activeSpace && !byId.has(activeSpace.id)) {
      byId.set(activeSpace.id, {
        ...activeSpace,
        parent_id: activeSpace.parent_id ?? prevId,
      });
    }

    const childrenOf = new Map<string, Space[]>();
    for (const sp of byId.values()) {
      const parentId = sp.parent_id;
      const key = parentId && byId.has(parentId) ? parentId : "__root__";
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(sp);
    }
    for (const list of childrenOf.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    const build = (sp: Space): TreeNode => ({
      space: sp,
      children: (childrenOf.get(sp.id) ?? []).map(build),
    });
    return (childrenOf.get("__root__") ?? []).map(build);
  }, [mySpaces, activeSpaceAncestors, activeSpace]);

  const goTo = (id: string) => {
    navigate(`/spaces/${id}`);
    onNavigate?.();
  };

  const scrollToSection = (anchorId: string) => {
    document
      .getElementById(anchorId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    onNavigate?.();
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const { space } = node;
    const isActive = activeSpace?.id === space.id;
    const hasChildren = node.children.length > 0;
    const isOpen = activePathIds.has(space.id) || !collapsed.has(space.id);
    const Icon = NODE_ICON(space.kind);
    return (
      <div key={space.id}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-control py-1.5 pr-2 text-[13px] transition-colors",
            "hover:bg-glass-hover",
            isActive && "bg-surface-3",
          )}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(space.id)}
              className="shrink-0 cursor-pointer rounded-control p-0.5 text-text-muted hover:text-text-primary"
              aria-label={
                isOpen
                  ? t("spaces.coursePage.nav.collapseNode")
                  : t("spaces.coursePage.nav.expandNode")
              }
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="w-[18px] shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => goTo(space.id)}
            className={cn(
              "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 truncate text-left",
              isActive
                ? "font-medium text-text-primary"
                : "text-text-secondary",
            )}
            title={space.name}
          >
            <Icon
              size={13}
              strokeWidth={1.75}
              className="shrink-0 text-text-muted"
            />
            <span className="truncate">{space.name}</span>
          </button>
        </div>
        {isActive && (
          <div>
            <button
              type="button"
              onClick={() => scrollToSection("section-general")}
              className="flex w-full cursor-pointer items-center truncate rounded-control py-1.5 pr-2 text-left text-[13px] text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
              style={{ paddingLeft: 8 + (depth + 1) * 16 }}
            >
              {t("spaces.coursePage.nav.general")}
            </button>
            {activeSpaceSections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToSection(`section-${section.id}`)}
                className="flex w-full cursor-pointer items-center truncate rounded-control py-1.5 pr-2 text-left text-[13px] text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
                style={{ paddingLeft: 8 + (depth + 1) * 16 }}
                title={section.title}
              >
                {section.title || t("spaces.coursePage.untitledSection")}
              </button>
            ))}
          </div>
        )}
        {hasChildren &&
          isOpen &&
          node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  if (roots.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-text-muted">
        {t("spaces.coursePage.nav.empty")}
      </p>
    );
  }

  return <div className="py-2">{roots.map((n) => renderNode(n, 0))}</div>;
}
