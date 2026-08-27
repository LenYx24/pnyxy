import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import {
  Button,
  FormModal,
  IconButton,
  Toggle,
  fieldClass,
  segmentedGroupClass,
  segmentedItemActiveClass,
  segmentedItemClass,
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

/** Grid shared by the column header row and every space row: tile, name,
 *  kebab on mobile; type and term columns come back at md. Mirrors the
 *  library list-view anatomy (44px rows, 36px tile). */
const SPACE_GRID_CLASS =
  "grid grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-3 px-3 md:grid-cols-[36px_minmax(0,1fr)_120px_140px_36px]";
const SPACE_ROW_BASE_CLASS =
  "group h-[44px] select-none text-sm transition-colors hover:bg-glass-hover cursor-pointer";

function isContainerKind(kind: SpaceKind): boolean {
  return kind === "org" || kind === "subspace";
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
  const [extraChildren, setExtraChildren] = useState<Space[]>([]);
  const [termFilter, setTermFilter] = useState("all");
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);

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
  const ownedChildren = drilledSpace
    ? mySpaces.filter((s) => s.parent_id === drilledSpace.id)
    : [];
  const usingExtraChildren = !!drilledSpace && ownedChildren.length === 0;

  // A drilled org with no joined children: fetch its children directly so
  // public, not-yet-joined courses still show up (RLS filters visibility).
  useEffect(() => {
    if (!drilledSpace || ownedChildren.length > 0) {
      setExtraChildren([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const rows = await fetchChildrenOf(drilledSpace.id);
      if (cancelled) return;
      setExtraChildren(rows);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownedChildren.length already gates the fetch
  }, [drilledSpace, mySpaces, fetchChildrenOf]);

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

  const childCount = (spaceId: string) =>
    mySpaces.filter((s) => s.parent_id === spaceId).length;

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
  const baseList = drilledSpace
    ? usingExtraChildren
      ? extraChildren
      : ownedChildren
    : rootSpaces;
  const visibleList = baseList.filter(matchesTerm);
  const discover = publicSpaces.filter((s) => !memberIds.has(s.id));
  const noSpacesAtAll = !loading && mySpaces.length === 0 && !drilledSpace;

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
          <Button
            variant="primary"
            size="sm"
            onClick={() => setNewSpaceOpen(true)}
          >
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={termFilter}
              onChange={(e) => setTermFilter(e.target.value)}
              className={cn(fieldClass, "w-auto cursor-pointer")}
            >
              <option value="all">{t("spaces.list.termAll")}</option>
              {termOptions.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
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
              <span />
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
              visibleList.map((space) => (
                <SpaceRow
                  key={space.id}
                  space={space}
                  joinable={usingExtraChildren}
                  isOwner={space.owner_id === user.id}
                  childCount={childCount(space.id)}
                  term={latestTerm(space.id)}
                  joining={joiningId === space.id}
                  onNavigate={handleNavigate}
                  onDrillIn={handleDrillIn}
                  onJoin={handleJoin}
                  onLeave={handleLeave}
                />
              ))
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
                      <SpaceRow
                        key={space.id}
                        space={space}
                        joinable
                        isOwner={space.owner_id === user.id}
                        childCount={0}
                        term={null}
                        joining={joiningId === space.id}
                        onNavigate={handleNavigate}
                        onDrillIn={handleNavigate}
                        onJoin={handleJoin}
                        onLeave={handleLeave}
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

interface SpaceRowProps {
  space: Space;
  /** True when this row is an unjoined space shown for discovery/browsing;
   *  the kebab column becomes a small "Join" button instead. */
  joinable: boolean;
  isOwner: boolean;
  childCount: number;
  term: string | null;
  joining: boolean;
  onNavigate: (id: string) => void;
  onDrillIn: (id: string) => void;
  onJoin: (id: string) => void;
  onLeave: (space: Space) => void;
}

function SpaceRow({
  space,
  joinable,
  isOwner,
  childCount,
  term,
  joining,
  onNavigate,
  onDrillIn,
  onJoin,
  onLeave,
}: SpaceRowProps) {
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
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-control",
            container
              ? "bg-accent-soft text-accent"
              : "bg-bg-tertiary text-text-muted",
          )}
        >
          {container ? (
            <Building2 size={18} strokeWidth={1.5} />
          ) : (
            <GraduationCap size={18} strokeWidth={1.5} />
          )}
        </span>

        <div className="flex min-w-0 flex-col justify-center">
          <span className="truncate font-medium text-text-primary">
            {space.name}
          </span>
          {space.kind === "org" && childCount > 0 && (
            <span className="truncate text-2xs text-text-muted">
              {t("spaces.list.courseCount", {
                count: childCount,
              })}
            </span>
          )}
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
          {joinable ? (
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
          ) : (
            <IconButton
              size="sm"
              onClick={(e) => openMenuAtButton(e, menuItems())}
              aria-label={t("spaces.actions")}
              title={t("spaces.actions")}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontal size={16} strokeWidth={1.5} />
            </IconButton>
          )}
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

function NewSpaceModal({
  open,
  onClose,
  mySpaces,
}: {
  open: boolean;
  onClose: () => void;
  mySpaces: Space[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createSpace = useSpaceStore((s) => s.createSpace);
  const [name, setName] = useState("");
  const [kind, setKind] =
    useState<Extract<SpaceKind, "course" | "org">>("course");
  const [whereId, setWhereId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The modal stays mounted (only `open` toggles), reset the form
  // whenever it opens so a previous attempt doesn't linger.
  const [openSnapshot, setOpenSnapshot] = useState(open);
  if (open !== openSnapshot) {
    setOpenSnapshot(open);
    if (open) {
      setName("");
      setKind("course");
      setWhereId("");
      setIsPrivate(false);
      setError(null);
    }
  }

  const containers = mySpaces.filter((s) => isContainerKind(s.kind));

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
        <div className={segmentedGroupClass}>
          <button
            type="button"
            className={cn(
              segmentedItemClass,
              kind === "course" && segmentedItemActiveClass,
            )}
            onClick={() => setKind("course")}
          >
            {t("spaces.kind.course")}
          </button>
          <button
            type="button"
            className={cn(
              segmentedItemClass,
              kind === "org" && segmentedItemActiveClass,
            )}
            onClick={() => setKind("org")}
          >
            {t("spaces.kind.org")}
          </button>
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
        <label
          className="mb-1.5 block text-xs font-medium text-text-muted"
          htmlFor="new-space-where"
        >
          {t("spaces.newSpace.whereLabel")}
        </label>
        <select
          id="new-space-where"
          value={whereId}
          onChange={(e) => setWhereId(e.target.value)}
          className={cn(fieldClass, "cursor-pointer bg-bg-secondary")}
        >
          <option value="">{t("spaces.newSpace.whereRoot")}</option>
          {containers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
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
