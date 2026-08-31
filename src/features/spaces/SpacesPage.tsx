import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderPlus,
  GraduationCap,
  Hash,
  KeyRound,
  Layers,
  Loader2,
  LogIn,
  LogOut,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Button,
  FormModal,
  IconButton,
  Select,
  Toggle,
  fieldClass,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import { useSpaceStore } from "@/stores/space-store";
import { useConfirm } from "@/hooks/use-confirm";
import { openMenuAtButton } from "@/features/chat/menu-anchor";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import {
  ROW_FOCUS_CLASS,
  ROW_SEPARATOR_CLASS,
  handleRowKeyDown,
} from "@/features/library/list-view/helpers";
import type { Offering, Space, SpaceKind } from "@/types/space";

/** Grid shared by the column header row and every space row: the chevron,
 *  tile and name live in one flexible first column (indented per tree
 *  depth so type/term/kebab columns stay aligned across depths); type and
 *  term columns come back at md. Mirrors the library list-view anatomy
 *  (44px rows, 36px tile). */
const SPACE_GRID_CLASS =
  "grid grid-cols-[minmax(0,1fr)_36px] items-center gap-3 px-3 md:grid-cols-[minmax(0,1fr)_120px_140px_36px]";
const SPACE_ROW_BASE_CLASS =
  "group h-[44px] select-none text-sm transition-colors hover:bg-glass-hover cursor-pointer";

/** Indent per nesting level in the tree, in px. */
const TREE_INDENT_PX = 18;

const LAST_ORG_KEY = "pnyxy:spaces-last-org";
const EXPANDED_KEY = "pnyxy:spaces-expanded";

function isContainerKind(kind: SpaceKind): boolean {
  return kind === "org" || kind === "subspace";
}

function KindIcon({ kind, size = 18 }: { kind: SpaceKind; size?: number }) {
  const Icon: LucideIcon =
    kind === "course" ? GraduationCap : kind === "topic" ? Hash : Building2;
  return <Icon size={size} strokeWidth={1.5} />;
}

function readExpandedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeExpandedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // private mode: not fatal, just won't persist
  }
}

function readLastOrgId(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

function writeLastOrgId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_ORG_KEY, id);
    else localStorage.removeItem(LAST_ORG_KEY);
  } catch {
    // private mode: not fatal, just won't persist
  }
}

export function SpacesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const {
    mySpaces,
    publicSpaces,
    memberIds,
    loading,
    error,
    fetchAll,
    joinSpace,
    leaveSpace,
    fetchOfferingsFor,
    fetchChildrenOf,
  } = useSpaceStore(
    useShallow((s) => ({
      mySpaces: s.mySpaces,
      publicSpaces: s.publicSpaces,
      memberIds: s.memberIds,
      loading: s.loading,
      error: s.error,
      fetchAll: s.fetchAll,
      joinSpace: s.joinSpace,
      leaveSpace: s.leaveSpace,
      fetchOfferingsFor: s.fetchOfferingsFor,
      fetchChildrenOf: s.fetchChildrenOf,
    })),
  );
  const { confirm, ConfirmModalElement } = useConfirm();

  const [searchParams, setSearchParams] = useSearchParams();
  const drilledId = searchParams.get("in");

  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [termFilter, setTermFilter] = useState("all");
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [newSpaceInit, setNewSpaceInit] = useState<{
    parentId: string | null;
    kind: SpaceKind;
  } | null>(null);
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);

  // Extra (not-yet-joined) children fetched lazily per node id, keyed by
  // parent space id. Merged with the owned children already in mySpaces.
  const [childrenCache, setChildrenCache] = useState<Record<string, Space[]>>(
    {},
  );
  const loadingChildrenRef = useRef<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    readExpandedIds(),
  );

  useEffect(() => {
    if (user) void fetchAll();
  }, [user, fetchAll]);

  // Offerings for every space the user belongs to, fetched in one call so
  // the term filter and the term column don't need a query per row.
  useEffect(() => {
    const ids = mySpaces.map((s) => s.id);
    if (ids.length === 0) {
      setOfferings([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const rows = await fetchOfferingsFor(ids);
      if (cancelled) return;
      setOfferings(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [mySpaces, fetchOfferingsFor]);

  const mySpaceIds = useMemo(
    () => new Set(mySpaces.map((s) => s.id)),
    [mySpaces],
  );
  const drilledSpace = drilledId
    ? (mySpaces.find((s) => s.id === drilledId) ?? null)
    : null;

  const ensureChildrenLoaded = useCallback(
    (spaceId: string) => {
      if (childrenCache[spaceId] !== undefined) return;
      if (loadingChildrenRef.current.has(spaceId)) return;
      loadingChildrenRef.current.add(spaceId);
      void (async () => {
        const rows = await fetchChildrenOf(spaceId);
        loadingChildrenRef.current.delete(spaceId);
        setChildrenCache((prev) =>
          prev[spaceId] !== undefined ? prev : { ...prev, [spaceId]: rows },
        );
      })();
    },
    [childrenCache, fetchChildrenOf],
  );

  // Direct children of a node: owned (from mySpaces) merged with whatever
  // was lazily fetched (still-public, not-yet-joined ones), deduped.
  const childrenOf = useCallback(
    (spaceId: string): Space[] => {
      const owned = mySpaces.filter((s) => s.parent_id === spaceId);
      const extra = childrenCache[spaceId] ?? [];
      const byId = new Map<string, Space>();
      for (const s of extra) byId.set(s.id, s);
      for (const s of owned) byId.set(s.id, s);
      return Array.from(byId.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    },
    [mySpaces, childrenCache],
  );

  // A drilled space's children aren't necessarily all joined yet (public,
  // not-yet-joined courses should still show up; RLS filters visibility).
  useEffect(() => {
    if (drilledSpace) ensureChildrenLoaded(drilledSpace.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when the drilled id itself changes
  }, [drilledSpace?.id]);

  // Restore the last-drilled org on a bare landing (no ?in= yet), once.
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (searchParams.get("in")) {
      restoreAttemptedRef.current = true;
      return;
    }
    if (mySpaces.length === 0) return;
    restoreAttemptedRef.current = true;
    const lastId = readLastOrgId();
    if (lastId && mySpaces.some((s) => s.id === lastId)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("in", lastId);
          return next;
        },
        { replace: true },
      );
    }
  }, [mySpaces, searchParams, setSearchParams]);

  // Persist the drilled org for next visit, once the restore decision above
  // has already had its chance (otherwise a bare landing would immediately
  // overwrite the remembered id with null before it gets to restore it).
  useEffect(() => {
    if (!restoreAttemptedRef.current) return;
    writeLastOrgId(drilledId);
  }, [drilledId]);

  const offeringsBySpace = useMemo(() => {
    const map = new Map<string, Offering[]>();
    for (const o of offerings) {
      const list = map.get(o.space_id) ?? [];
      list.push(o);
      map.set(o.space_id, list);
    }
    return map;
  }, [offerings]);

  const latestTerm = (spaceId: string): string | null => {
    const list = offeringsBySpace.get(spaceId);
    if (!list || list.length === 0) return null;
    const sorted = [...list].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return sorted[0].term_label;
  };

  const termOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of offerings) set.add(o.term_label);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [offerings]);

  const matchesTerm = (space: Space): boolean => {
    if (termFilter === "all" || isContainerKind(space.kind)) return true;
    const list = offeringsBySpace.get(space.id) ?? [];
    return list.some((o) => o.term_label === termFilter);
  };

  const handleDrillIn = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("in", id);
      return next;
    });
  };
  const handleBack = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("in");
      return next;
    });
  };
  const handleNavigate = (id: string) => navigate(`/spaces/${id}`);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        ensureChildrenLoaded(id);
      }
      writeExpandedIds(next);
      return next;
    });
  };

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    try {
      await joinSpace(id);
    } catch {
      // surfaced via store error
    } finally {
      setJoiningId(null);
    }
  };

  const handleLeave = async (space: Space) => {
    const ok = await confirm({
      title: t("spaces.list.leaveConfirmTitle"),
      body: t("spaces.list.leaveConfirmBody"),
      confirmLabel: t("spaces.list.leave"),
      danger: true,
    });
    if (!ok) return;
    try {
      await leaveSpace(space.id);
      if (drilledId === space.id) handleBack();
    } catch {
      // surfaced via store error
    }
  };

  const handleOpenNewSpace = () => {
    setNewSpaceInit(null);
    setNewSpaceOpen(true);
  };
  const handleAddChildHere = (space: Space) => {
    setNewSpaceInit({
      parentId: space.id,
      kind: space.kind === "org" ? "subspace" : "course",
    });
    setNewSpaceOpen(true);
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
        <PageTitle />
        <section className="rounded-panel bg-bg-tertiary p-6 text-center">
          <p className="mb-4 text-text-secondary">{t("spaces.signInPrompt")}</p>
          <Link to="/auth">
            <Button>
              <LogIn size={16} />
              {t("auth.signIn")}
            </Button>
          </Link>
        </section>
      </div>
    );
  }

  const rootSpaces = mySpaces.filter(
    (s) => !s.parent_id || !mySpaceIds.has(s.parent_id),
  );
  const switcherRoots = rootSpaces.filter((s) => isContainerKind(s.kind));
  const visibleRoots = drilledSpace ? childrenOf(drilledSpace.id) : rootSpaces;
  const visibleList = visibleRoots.filter(matchesTerm);
  const discover = publicSpaces.filter((s) => !memberIds.has(s.id));
  const noSpacesAtAll = !loading && mySpaces.length === 0 && !drilledSpace;

  const switcherMenuItems = (): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "all",
        label: t("spaces.list.switcherAll"),
        icon: Layers,
        onClick: handleBack,
      },
    ];
    if (switcherRoots.length > 0) {
      items.push({ id: "div-switcher", divider: true });
      for (const s of switcherRoots) {
        items.push({
          id: s.id,
          label: s.name,
          icon: Building2,
          onClick: () => handleDrillIn(s.id),
        });
      }
    }
    return items;
  };

  const renderSpaceTree = (list: Space[], depth: number) =>
    list.filter(matchesTerm).map((space) => {
      const container = isContainerKind(space.kind);
      const expanded = expandedIds.has(space.id);
      return (
        <div key={space.id}>
          <SpaceTreeRow
            space={space}
            depth={depth}
            isOwner={space.owner_id === user.id}
            childCount={childrenOf(space.id).length}
            term={latestTerm(space.id)}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onNavigate={handleNavigate}
            onDrillIn={handleDrillIn}
            onLeave={handleLeave}
            onAddChildHere={handleAddChildHere}
          />
          {container && expanded && renderSpaceTree(childrenOf(space.id), depth + 1)}
        </div>
      );
    });

  return (
    <div className="w-full space-y-5 p-4 sm:px-8 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle />
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setJoinCodeOpen(true)}
          >
            <KeyRound size={14} />
            {t("spaces.list.joinCodeTrigger")}
          </Button>
          <Button variant="primary" size="sm" onClick={handleOpenNewSpace}>
            <Plus size={14} />
            {t("spaces.newSpace.trigger")}
          </Button>
        </div>
      </header>

      {error && <p className="text-xs text-danger">{error}</p>}

      {loading && mySpaces.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : noSpacesAtAll ? (
        <p className="py-12 text-center text-sm text-text-muted">
          {t("spaces.list.emptyRoot")}
        </p>
      ) : (
        <>
          {mySpaces.length > 0 && (
            <button
              type="button"
              onClick={(e) => openMenuAtButton(e, switcherMenuItems())}
              className="flex w-fit max-w-full items-center gap-1.5 rounded-control bg-bg-tertiary px-3 py-1.5 text-left text-sm font-medium text-text-primary transition-colors hover:bg-glass-hover cursor-pointer"
              aria-label={t("spaces.list.switcherLabel")}
              title={t("spaces.list.switcherLabel")}
            >
              <Building2
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-accent"
              />
              <span className="max-w-[240px] truncate">
                {drilledSpace ? drilledSpace.name : t("spaces.list.switcherAll")}
              </span>
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-text-muted"
              />
            </button>
          )}

          {!drilledSpace && mySpaces.length > 0 && (
            <MySpacesQuickSection spaces={mySpaces} onNavigate={handleNavigate} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select
              value={termFilter}
              onChange={setTermFilter}
              options={[
                { value: "all", label: t("spaces.list.termAll") },
                ...termOptions.map((term) => ({ value: term, label: term })),
              ]}
              size="sm"
              ariaLabel={t("spaces.list.termAll")}
              className="w-auto"
            />
            <span className="text-xs text-text-muted">
              {t("spaces.list.rowCount", {
                count: visibleList.length,
              })}
            </span>
          </div>

          {drilledSpace && (
            <button
              type="button"
              onClick={handleBack}
              className="flex w-full items-center gap-1.5 rounded-control px-1 py-2 text-left text-xs font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <ChevronLeft size={16} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">{t("spaces.title")}</span>
              <span className="mx-1 text-text-muted-2">/</span>
              <span className="min-w-0 flex-1 truncate text-text-primary">
                {drilledSpace.name}
              </span>
            </button>
          )}

          <div data-list-root="">
            <div
              className={cn(
                SPACE_GRID_CLASS,
                ROW_SEPARATOR_CLASS,
                "py-2 text-2xs font-semibold uppercase tracking-wider text-text-muted-2",
              )}
            >
              <span>{t("spaces.list.colName")}</span>
              <span className="hidden md:block">
                {t("spaces.list.colType")}
              </span>
              <span className="hidden md:block">
                {t("spaces.list.colTerm")}
              </span>
              <span />
            </div>

            {visibleList.length === 0 ? (
              <p className="py-10 text-center text-sm text-text-muted">
                {drilledSpace
                  ? t("spaces.list.emptyDrilled")
                  : t("spaces.list.emptyFiltered")}
              </p>
            ) : (
              renderSpaceTree(visibleList, 0)
            )}
          </div>

          {!drilledSpace && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setDiscoverOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 rounded-control px-1 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <ChevronRight
                  size={14}
                  strokeWidth={1.5}
                  className={cn(
                    "shrink-0 transition-transform",
                    discoverOpen && "rotate-90",
                  )}
                />
                <span>{t("spaces.list.discover")}</span>
              </button>
              {discoverOpen &&
                (discover.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-muted">
                    {t("spaces.discoverEmpty")}
                  </p>
                ) : (
                  <div data-list-root="">
                    {discover.map((space) => (
                      <DiscoverRow
                        key={space.id}
                        space={space}
                        joining={joiningId === space.id}
                        onNavigate={handleNavigate}
                        onJoin={handleJoin}
                      />
                    ))}
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {ConfirmModalElement}
      <JoinCodeModal
        open={joinCodeOpen}
        onClose={() => setJoinCodeOpen(false)}
      />
      <NewSpaceModal
        open={newSpaceOpen}
        onClose={() => setNewSpaceOpen(false)}
        mySpaces={mySpaces}
        initialParentId={newSpaceInit?.parentId ?? null}
        initialKind={newSpaceInit?.kind ?? "course"}
      />
    </div>
  );
}

function PageTitle() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">
        {t("spaces.title")}
      </h1>
      <p className="text-sm text-text-muted">{t("spaces.subtitle")}</p>
    </div>
  );
}

/** Landing shortcut bar: the user's active spaces, most-recent first, so
 *  they don't have to pick a space (drill in) every visit. Always
 *  navigates straight to the space's own page. */
function MySpacesQuickSection({
  spaces,
  onNavigate,
}: {
  spaces: Space[];
  onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const sorted = useMemo(
    () =>
      [...spaces].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (tb !== ta) return tb - ta;
        return a.name.localeCompare(b.name);
      }),
    [spaces],
  );
  if (sorted.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-muted-2">
        {t("spaces.list.mySpacesHeading")}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {sorted.map((space) => (
          <button
            key={space.id}
            type="button"
            onClick={() => onNavigate(space.id)}
            className="flex items-center gap-2 rounded-panel bg-bg-tertiary px-3 py-2.5 text-left transition-colors hover:bg-glass-hover cursor-pointer"
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-control",
                isContainerKind(space.kind)
                  ? "bg-accent-soft text-accent"
                  : "bg-bg-secondary text-text-muted",
              )}
            >
              <KindIcon kind={space.kind} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text-primary">
                {space.name}
              </span>
              <span className="block truncate text-2xs text-text-muted">
                {t(`spaces.kind.${space.kind}`, { defaultValue: space.kind })}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

interface SpaceTreeRowProps {
  space: Space;
  /** Nesting depth inside the tree; 0 = a root row. */
  depth: number;
  isOwner: boolean;
  childCount: number;
  term: string | null;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onNavigate: (id: string) => void;
  onDrillIn: (id: string) => void;
  onLeave: (space: Space) => void;
  onAddChildHere: (space: Space) => void;
}

/** One row of the tree: org/subspace rows carry a chevron that expands
 *  their children inline (lazy-loaded); course/topic rows are leaves
 *  that navigate straight to the space's page. */
function SpaceTreeRow({
  space,
  depth,
  isOwner,
  childCount,
  term,
  expanded,
  onToggleExpand,
  onNavigate,
  onDrillIn,
  onLeave,
  onAddChildHere,
}: SpaceTreeRowProps) {
  const { t } = useTranslation();
  const container = isContainerKind(space.kind);
  const open = () => (container ? onDrillIn(space.id) : onNavigate(space.id));

  const menuItems = (): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "open",
        label: t("common.open"),
        icon: ExternalLink,
        onClick: () => onNavigate(space.id),
      },
    ];
    if (container && isOwner) {
      items.push({
        id: "add-child",
        label: t("spaces.list.addChildHere"),
        icon: FolderPlus,
        onClick: () => onAddChildHere(space),
      });
    }
    if (!isOwner) {
      items.push({
        id: "leave",
        label: t("spaces.list.leave"),
        icon: LogOut,
        danger: true,
        onClick: () => onLeave(space),
      });
    }
    return items;
  };

  return (
    <div
      data-list-row=""
      tabIndex={0}
      onKeyDown={(e) =>
        handleRowKeyDown(e, { onOpen: open, onToggleSelect: () => {} })
      }
      className={ROW_FOCUS_CLASS}
    >
      <div
        className={cn(
          SPACE_GRID_CLASS,
          SPACE_ROW_BASE_CLASS,
          ROW_SEPARATOR_CLASS,
          "relative",
        )}
        onClick={open}
      >
        <div
          className="flex min-w-0 items-center gap-2"
          style={{ paddingLeft: depth * TREE_INDENT_PX }}
        >
          {container ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(space.id);
              }}
              aria-label={t(
                expanded ? "spaces.list.collapse" : "spaces.list.expand",
              )}
              aria-expanded={expanded}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              {expanded ? (
                <ChevronDown size={14} strokeWidth={1.5} />
              ) : (
                <ChevronRight size={14} strokeWidth={1.5} />
              )}
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-control",
              container
                ? "bg-accent-soft text-accent"
                : "bg-bg-tertiary text-text-muted",
            )}
          >
            <KindIcon kind={space.kind} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-text-primary">
              {space.name}
            </span>
            {space.kind === "org" && childCount > 0 && (
              <span className="block truncate text-2xs text-text-muted">
                {t("spaces.list.courseCount", {
                  count: childCount,
                })}
              </span>
            )}
          </span>
        </div>

        <span className="hidden truncate text-text-muted md:block">
          {t(`spaces.kind.${space.kind}`, { defaultValue: space.kind })}
        </span>

        <span className="hidden truncate text-text-muted md:block">
          {term ?? ""}
        </span>

        <div
          className="relative flex justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton
            size="sm"
            onClick={(e) => openMenuAtButton(e, menuItems())}
            aria-label={t("spaces.actions")}
            title={t("spaces.actions")}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/** Simple, non-tree row for the "Discover public spaces" fold: not-yet-
 *  joined spaces, so container rows also just navigate (there is nothing
 *  of the user's own to expand yet) and the kebab becomes a Join button. */
function DiscoverRow({
  space,
  joining,
  onNavigate,
  onJoin,
}: {
  space: Space;
  joining: boolean;
  onNavigate: (id: string) => void;
  onJoin: (id: string) => void;
}) {
  const { t } = useTranslation();
  const container = isContainerKind(space.kind);
  const open = () => onNavigate(space.id);

  return (
    <div
      data-list-row=""
      tabIndex={0}
      onKeyDown={(e) =>
        handleRowKeyDown(e, { onOpen: open, onToggleSelect: () => {} })
      }
      className={ROW_FOCUS_CLASS}
    >
      <div
        className={cn(
          SPACE_GRID_CLASS,
          SPACE_ROW_BASE_CLASS,
          ROW_SEPARATOR_CLASS,
          "relative",
        )}
        onClick={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-control",
              container
                ? "bg-accent-soft text-accent"
                : "bg-bg-tertiary text-text-muted",
            )}
          >
            <KindIcon kind={space.kind} />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
            {space.name}
          </span>
        </div>

        <span className="hidden truncate text-text-muted md:block">
          {t(`spaces.kind.${space.kind}`, { defaultValue: space.kind })}
        </span>
        <span className="hidden truncate text-text-muted md:block" />

        <div
          className="relative flex justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={joining}
            onClick={() => onJoin(space.id)}
          >
            {joining ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              t("spaces.join")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function JoinCodeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const joinWithCode = useSpaceStore((s) => s.joinWithCode);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The modal stays mounted (only `open` toggles), reset the form
  // whenever it opens so a previous attempt doesn't linger.
  const [openSnapshot, setOpenSnapshot] = useState(open);
  if (open !== openSnapshot) {
    setOpenSnapshot(open);
    if (open) {
      setCode("");
      setErr(null);
    }
  }

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const spaceId = await joinWithCode(trimmed);
      onClose();
      navigate(`/spaces/${spaceId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(
        msg.includes("too_many_attempts")
          ? t("spaces.joinCode.tooMany")
          : t("spaces.joinCode.invalid"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={t("spaces.joinCode.heading")}
      size="sm"
      onSubmit={() => void submit()}
      submitLabel={t("spaces.joinCode.join")}
      submitting={busy}
      submitDisabled={!code.trim()}
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={t("spaces.joinCode.placeholder")}
        className={cn(fieldClass, "bg-bg-secondary font-mono tracking-widest")}
      />
      {err && (
        <p className="text-xs text-danger" role="alert">
          {err}
        </p>
      )}
    </FormModal>
  );
}

/** Type options for the "New space" modal, in the order they're offered. */
const NEW_SPACE_KINDS: {
  value: SpaceKind;
  icon: LucideIcon;
  labelKey: string;
}[] = [
  { value: "org", icon: Building2, labelKey: "spaces.newSpace.kindOrg" },
  {
    value: "subspace",
    icon: Building2,
    labelKey: "spaces.newSpace.kindSubspace",
  },
  {
    value: "course",
    icon: GraduationCap,
    labelKey: "spaces.newSpace.kindCourse",
  },
  { value: "topic", icon: Hash, labelKey: "spaces.newSpace.kindTopic" },
];

function NewSpaceModal({
  open,
  onClose,
  mySpaces,
  initialParentId = null,
  initialKind = "course",
}: {
  open: boolean;
  onClose: () => void;
  mySpaces: Space[];
  /** Preselects the "Where" parent, e.g. from a row's "Add space here" kebab. */
  initialParentId?: string | null;
  /** Suggested type for that context (subspace under an org, course under a subspace). */
  initialKind?: SpaceKind;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createSpace = useSpaceStore((s) => s.createSpace);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SpaceKind>(initialKind);
  const [whereId, setWhereId] = useState(initialParentId ?? "");
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The modal stays mounted (only `open` toggles), reset the form
  // whenever it opens so a previous attempt doesn't linger, and pick up
  // whatever parent/kind context it was opened with this time.
  const [openSnapshot, setOpenSnapshot] = useState(open);
  if (open !== openSnapshot) {
    setOpenSnapshot(open);
    if (open) {
      setName("");
      setKind(initialKind);
      setWhereId(initialParentId ?? "");
      setIsPrivate(false);
      setError(null);
    }
  }

  // A topic's natural parent is a course, an org/subspace's is another
  // container; the picker's option set follows whichever kind is active.
  const whereOptions = useMemo(() => {
    const parents =
      kind === "topic"
        ? mySpaces.filter((s) => isContainerKind(s.kind) || s.kind === "course")
        : mySpaces.filter((s) => isContainerKind(s.kind));
    return [
      { value: "", label: t("spaces.newSpace.whereRoot") },
      ...parents.map((p) => ({ value: p.id, label: p.name })),
    ];
  }, [kind, mySpaces, t]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const id = await createSpace({
        name: trimmed,
        kind,
        parentId: whereId || null,
        visibility: isPrivate ? "private" : "public",
        // a course starts with one real, editable section, not a phantom
        seedSections:
          kind === "course"
            ? [t("spaces.newSpace.firstSection", "Introduction")]
            : [],
      });
      onClose();
      if (id) navigate(`/spaces/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("spaces.newSpace.error"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={t("spaces.newSpace.heading")}
      size="sm"
      onSubmit={() => void handleCreate()}
      submitLabel={t("spaces.create")}
      submitting={creating}
      submitDisabled={!name.trim()}
    >
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-muted">
          {t("spaces.newSpace.typeLabel")}
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {NEW_SPACE_KINDS.map(({ value, icon: Icon, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={cn(
                "flex items-center gap-2 rounded-control border border-surface-3/60 px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:text-text-primary cursor-pointer",
                kind === value && "border-accent bg-accent-soft text-accent",
              )}
            >
              <Icon size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          className="mb-1.5 block text-xs font-medium text-text-muted"
          htmlFor="new-space-name"
        >
          {t("spaces.newSpace.nameLabel")}
        </label>
        <input
          id="new-space-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("spaces.namePlaceholder")}
          className={cn(fieldClass, "bg-bg-secondary")}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-muted">
          {t("spaces.newSpace.whereLabel")}
        </label>
        <Select
          value={whereId}
          onChange={setWhereId}
          options={whereOptions}
          ariaLabel={t("spaces.newSpace.whereLabel")}
          className="bg-bg-secondary"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-text-secondary">
          {t("spaces.newSpace.privateLabel")}
        </span>
        <Toggle checked={isPrivate} onChange={setIsPrivate} />
      </div>

      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </FormModal>
  );
}
