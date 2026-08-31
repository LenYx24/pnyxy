import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import {
  BadgeCheck,
  CalendarDays,
  CalendarPlus,
  FolderPlus,
  Loader2,
  LogOut,
  MessagesSquare,
  Eye,
  EyeOff,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Shapes,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button, FormModal, IconButton, Select, chipClass } from "@/components/ui";
import { openMenuAtButton } from "@/features/chat/menu-anchor";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore } from "@/stores/chat-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSpaceStore } from "@/stores/space-store";
import { track } from "@/lib/telemetry";
import { SpaceInviteSection } from "./SpaceFilesSection";
import { CourseNavTree } from "./CourseNavTree";
import { CourseSections } from "./CourseSections";
import { internalHref, isExternal } from "./content-shared";
import { useConfirm } from "@/hooks/use-confirm";
import { cn } from "@/lib/cn";
import { isSafeExternalUrl, safeInternalPath } from "@/lib/safe-url";
import type {
  Offering,
  OfferingStatus,
  SpaceContent,
  SpaceContentKind,
  SpaceKind,
  SpaceVisibility,
} from "@/types/space";

const OFFERING_STATUSES: OfferingStatus[] = ["active", "draft", "archived"];

const CHILD_KINDS: SpaceKind[] = ["course", "topic", "subspace"];

const CHILD_VISIBILITIES: SpaceVisibility[] = ["public", "private"];

const CONTENT_KINDS: SpaceContentKind[] = [
  "book",
  "resource",
  "quiz",
  "roadmap",
  "note",
  "whiteboard",
  "link",
];

const NAV_OPEN_KEY = "pnyxy:spaces-nav-open";

function readNavOpen(): boolean {
  try {
    const raw = localStorage.getItem(NAV_OPEN_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

function writeNavOpen(open: boolean): void {
  try {
    localStorage.setItem(NAV_OPEN_KEY, open ? "1" : "0");
  } catch {
    // private mode: not fatal, just won't persist
  }
}

export function CourseSpacePage() {
  const { t } = useTranslation();
  const { spaceId } = useParams<{ spaceId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.profile?.role === "admin");
  const { confirm, ConfirmModalElement } = useConfirm();
  const {
    activeSpace,
    activeSpaceAncestors,
    activeSpaceContent,
    activeSpaceOfferings,
    loading,
    memberIds,
    loadSpace,
    leaveSpace,
    enrollInCourse,
    removeOffering,
    deleteSpace,
    previewAsMember,
    setPreviewAsMember,
  } = useSpaceStore(
    useShallow((s) => ({
      activeSpace: s.activeSpace,
      activeSpaceAncestors: s.activeSpaceAncestors,
      activeSpaceContent: s.activeSpaceContent,
      activeSpaceOfferings: s.activeSpaceOfferings,
      loading: s.loading,
      memberIds: s.memberIds,
      loadSpace: s.loadSpace,
      leaveSpace: s.leaveSpace,
      previewAsMember: s.previewAsMember,
      setPreviewAsMember: s.setPreviewAsMember,
      enrollInCourse: s.enrollInCourse,
      removeOffering: s.removeOffering,
      deleteSpace: s.deleteSpace,
    })),
  );
  const folders = useChatStore((s) => s.folders);

  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addContentSectionId, setAddContentSectionId] = useState<string | null>(
    null,
  );
  const [addTermOpen, setAddTermOpen] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [createSectionOpen, setCreateSectionOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(() => readNavOpen());

  const toggleNav = () => {
    setNavOpen((v) => {
      const next = !v;
      writeNavOpen(next);
      return next;
    });
  };
  const closeMobileNav = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setNavOpen(false);
      writeNavOpen(false);
    }
  };

  useEffect(() => {
    if (spaceId) void loadSpace(spaceId);
  }, [spaceId, loadSpace]);

  // Load the user's library folders so enrolled resources can map to their study folder.
  useEffect(() => {
    if (spaceId && memberIds.has(spaceId)) {
      void useChatStore.getState().fetchFolders();
    }
  }, [spaceId, memberIds]);

  // stale = the store still holds another space (or nothing): while the
  // fetch runs, show a quiet skeleton instead of a spinner; content from
  // a DIFFERENT space must never flash here
  const stale = !activeSpace || activeSpace.id !== spaceId;
  if (!spaceId || (stale && loading)) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6" aria-busy="true">
        <div className="h-3 w-40 animate-pulse rounded-full bg-bg-tertiary" />
        <div className="space-y-2">
          <div className="h-8 w-64 animate-pulse rounded-control bg-bg-tertiary" />
          <div className="h-3 w-24 animate-pulse rounded-full bg-bg-tertiary" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-40 animate-pulse rounded-control bg-bg-tertiary" />
          <div className="h-8 w-32 animate-pulse rounded-control bg-bg-tertiary" />
        </div>
        <div className="h-40 animate-pulse rounded-panel bg-bg-secondary" />
      </div>
    );
  }

  if (!activeSpace || activeSpace.id !== spaceId) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 text-center sm:p-6">
        <p className="text-text-secondary">{t("spaces.notFound")}</p>
        <Link to="/spaces">
          <Button variant="secondary" size="sm">
            {t("spaces.back")}
          </Button>
        </Link>
      </div>
    );
  }

  const realOwner = !!user && activeSpace.owner_id === user.id;
  // editor affordances hide while previewing as a member
  const owner = realOwner && !previewAsMember;
  const isMember = memberIds.has(spaceId);

  const handleEnroll = async () => {
    setBusy(true);
    try {
      if (isMember) await leaveSpace(spaceId);
      else await enrollInCourse(activeSpace);
    } catch {
      // surfaced via store error
    } finally {
      setBusy(false);
    }
  };

  // Root library folder created for this course by enrollInCourse.
  const courseFolder = folders.find(
    (f) =>
      (f.parent_id ?? null) === null &&
      f.name.trim().toLowerCase() === activeSpace.name.trim().toLowerCase(),
  );

  // Per-resource study folder nested under the course folder.
  const folderForItem = (item: SpaceContent) =>
    courseFolder
      ? folders.find(
          (f) =>
            f.parent_id === courseFolder.id &&
            f.name.trim().toLowerCase() ===
              item.title.slice(0, 120).trim().toLowerCase(),
        )
      : undefined;

  const openItemUrl = (url: string) => {
    if (isExternal(url)) {
      if (isSafeExternalUrl(url)) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (safeInternalPath(url)) navigate(url);
  };

  const openItem = (item: SpaceContent) => {
    // Prefer an explicit url for link / resource items.
    if (item.url && (item.kind === "link" || item.kind === "resource")) {
      openItemUrl(item.url);
      return;
    }
    const href = internalHref(item);
    if (href) {
      navigate(href);
      return;
    }
    if (item.url) {
      openItemUrl(item.url);
    }
  };

  // study-folder aware open, handed to CourseSections for every kind
  // except "file" (which it resolves itself via the shared file store).
  const openItemInStudyFolder = (item: SpaceContent) => {
    const studyFolder = isMember ? folderForItem(item) : undefined;
    if (studyFolder) {
      useLibraryStore.getState().navigateToFolder(studyFolder.id);
      navigate("/library");
      return;
    }
    openItem(item);
  };

  // "Start learning": open a course chat inside the course's library folder
  // and send the context turn right away, so the student's first message
  // is a real question and the model already knows the course.
  const askAi = () => {
    const sections = useSpaceStore.getState().activeSpaceSections;
    const general = activeSpaceContent.filter((c) => !c.section_id);
    const lines: string[] = [];
    const itemLine = (c: SpaceContent) => `  - ${c.title}`;
    if (general.length > 0) {
      lines.push(t("spaces.startSeed.general"), ...general.map(itemLine));
    }
    for (const section of sections) {
      const items = activeSpaceContent.filter(
        (c) => c.section_id === section.id,
      );
      lines.push(
        `- ${section.title}${items.length ? ":" : ""}`,
        ...items.map(itemLine),
      );
    }
    const org = activeSpaceAncestors.map((a) => a.name).join(" / ");
    const term = activeSpaceOfferings[0]?.term_label ?? "";
    const seedPrompt = [
      t("spaces.startSeed.intro", {
        name: activeSpace.name,
        org: org ? ` (${org})` : "",
        term: term ? `, ${term}` : "",
      }),
      activeSpace.description ? activeSpace.description : "",
      lines.length > 0
        ? t("spaces.startSeed.materials") + "\n" + lines.join("\n")
        : "",
      t("spaces.startSeed.outro"),
    ]
      .filter(Boolean)
      .join("\n\n");
    track("course_start_learning", { space: activeSpace.id });
    void (async () => {
      const folderId = await useSpaceStore
        .getState()
        .ensureCourseFolders(activeSpace);
      useChatStore
        .getState()
        .setPendingDraft({ text: seedPrompt, folderId, autoSend: true });
      navigate("/chat");
    })();
  };

  // secondary + administrative actions, one kebab instead of a button row
  const spaceMenuEntries = (): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "gallery",
        label: t("spaces.sharedAnswers"),
        icon: MessagesSquare,
        onClick: () => navigate(`/spaces/${spaceId}/gallery`),
      },
    ];
    if (owner) {
      items.push(
        {
          id: "add-section",
          label: t("spaces.coursePage.newSection"),
          icon: Plus,
          onClick: () => setCreateSectionOpen(true),
        },
        {
          id: "add-content",
          label: t("spaces.addContent"),
          icon: Plus,
          onClick: () => {
            setAddContentSectionId(null);
            setAddOpen(true);
          },
        },
        {
          id: "add-term",
          label: t("spaces.addTerm"),
          icon: CalendarPlus,
          onClick: () => setAddTermOpen(true),
        },
        {
          id: "add-child",
          label: t("spaces.addChild"),
          icon: FolderPlus,
          onClick: () => setAddChildOpen(true),
        },
      );
    }
    if (!owner && isMember) {
      items.push({
        id: "leave",
        label: t("spaces.leaveCourse"),
        icon: LogOut,
        onClick: () => void handleEnroll(),
      });
    }
    if (owner || isAdmin) {
      items.push(
        { id: "div-delete", divider: true },
        {
          id: "delete",
          label: t("spaces.delete.action"),
          icon: Trash2,
          danger: true,
          onClick: () => {
            void (async () => {
              const ok = await confirm({
                title: t("spaces.delete.title"),
                body: t("spaces.delete.body"),
                confirmLabel: t("common.delete"),
                danger: true,
              });
              if (!ok) return;
              await deleteSpace(spaceId!);
              navigate(
                activeSpace.parent_id
                  ? `/spaces/${activeSpace.parent_id}`
                  : "/spaces",
              );
            })();
          },
        },
      );
    }
    return items;
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-1">
      {/* LEFT: Navigáció tree, own scroll on desktop, a slide-in drawer below md */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-[280px] shrink-0 overflow-hidden border-r border-glass-border bg-bg-secondary transition-all duration-200",
          "md:static md:z-auto md:h-full md:translate-x-0 md:overflow-y-auto",
          navOpen
            ? "translate-x-0"
            : "-translate-x-full md:w-0 md:translate-x-0 md:border-r-0",
        )}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
            {t("spaces.coursePage.nav.heading")}
          </span>
          <IconButton
            size="sm"
            onClick={toggleNav}
            aria-label={t("spaces.coursePage.nav.collapse")}
            title={t("spaces.coursePage.nav.collapse")}
          >
            <PanelLeftClose size={15} strokeWidth={1.5} />
          </IconButton>
        </div>
        <CourseNavTree onNavigate={closeMobileNav} />
      </aside>
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => {
            setNavOpen(false);
            writeNavOpen(false);
          }}
        />
      )}

      {/* RIGHT: sticky header + the Moodle-style section column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-glass-border bg-bg-secondary px-6 py-3">
          {!navOpen && (
            <IconButton
              size="sm"
              onClick={toggleNav}
              aria-label={t("spaces.coursePage.nav.expand")}
              title={t("spaces.coursePage.nav.expand")}
            >
              <PanelLeftOpen size={15} strokeWidth={1.5} />
            </IconButton>
          )}
          <nav
            aria-label={t("spaces.breadcrumb")}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-text-muted"
          >
            {activeSpaceAncestors.map((a) => (
              <span key={a.id} className="flex shrink-0 items-center gap-1">
                <Link
                  to={`/spaces/${a.id}`}
                  className="max-w-[10rem] truncate rounded-control px-1 py-0.5 transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                >
                  {a.name}
                </Link>
                <span aria-hidden="true" className="text-text-muted-2">
                  /
                </span>
              </span>
            ))}
            <span className="flex min-w-0 items-center gap-1 truncate text-sm font-semibold text-text-primary">
              <span className="truncate">{activeSpace.name}</span>
              {activeSpace.official && (
                <>
                  <BadgeCheck
                    size={15}
                    className="shrink-0 text-accent"
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {t("spaces.coursePage.official")}
                  </span>
                </>
              )}
            </span>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {activeSpaceOfferings.length > 0 && (
              <span className={chipClass}>
                {activeSpaceOfferings[0].term_label}
              </span>
            )}
            {realOwner && (
              <Button
                variant={previewAsMember ? "soft" : "ghost"}
                size="sm"
                onClick={() => setPreviewAsMember(!previewAsMember)}
                title={t("spaces.coursePage.viewToggleHint")}
              >
                {previewAsMember ? (
                  <Eye size={14} strokeWidth={1.5} />
                ) : (
                  <EyeOff size={14} strokeWidth={1.5} />
                )}
                {previewAsMember
                  ? t("spaces.coursePage.viewAsMember")
                  : t("spaces.coursePage.viewAsEditor")}
              </Button>
            )}
            {owner && (
              <span className={chipClass}>{t("spaces.ownerChip")}</span>
            )}
            {!owner && isMember && (
              <span className={chipClass}>
                {t("spaces.coursePage.memberChip")}
              </span>
            )}
            {owner || isMember ? (
              <Button variant="soft" size="sm" onClick={askAi}>
                <Sparkles size={14} strokeWidth={1.5} />
                {t("spaces.startLearning")}
              </Button>
            ) : (
              <Button
                variant="soft"
                size="sm"
                onClick={() => void handleEnroll()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  t("spaces.enroll")
                )}
              </Button>
            )}
            <IconButton
              size="md"
              onClick={(e) => openMenuAtButton(e, spaceMenuEntries())}
              aria-label={t("spaces.actions")}
              title={t("spaces.actions")}
            >
              <MoreHorizontal size={18} strokeWidth={1.5} />
            </IconButton>
          </div>
        </header>

        {/* Owner of a private course: invite code up front, not buried
            below sections and offerings where nobody would find it. */}
        {owner && activeSpace.visibility !== "public" && (
          <div className="px-6 pt-4">
            <SpaceInviteSection spaceId={activeSpace.id} />
          </div>
        )}

        <CourseSections
          spaceId={spaceId}
          owner={owner}
          isMember={isMember}
          onOpenItem={openItemInStudyFolder}
          onOpenAddContent={(sectionId) => {
            setAddContentSectionId(sectionId);
            setAddOpen(true);
          }}
          createSectionOpen={createSectionOpen}
          onOpenCreateSection={() => setCreateSectionOpen(true)}
          onCloseCreateSection={() => setCreateSectionOpen(false)}
        />

        {/* Terms: a small kebab-managed card at the bottom of the column */}
        {(activeSpaceOfferings.length > 0 || owner) && (
          <section className="space-y-2 px-6 pb-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
                {t("spaces.offeringsHeading")}
              </h2>
              {owner && (
                <button
                  type="button"
                  onClick={() => setAddTermOpen(true)}
                  className="cursor-pointer text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
                >
                  {t("spaces.addTerm")}
                </button>
              )}
            </div>
            {activeSpaceOfferings.length > 0 ? (
              <ul className="space-y-2">
                {activeSpaceOfferings.map((offering) => (
                  <OfferingRow
                    key={offering.id}
                    offering={offering}
                    owner={owner}
                    onRemove={() => void removeOffering(offering.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="rounded-panel bg-bg-tertiary px-4 py-3 text-xs text-text-muted">
                {t("spaces.offeringsEmptyOwner")}
              </p>
            )}
          </section>
        )}
      </div>

      {owner && addOpen && (
        <AddContentModal
          spaceId={spaceId}
          sectionId={addContentSectionId}
          onClose={() => setAddOpen(false)}
        />
      )}

      {owner && addTermOpen && (
        <AddTermModal spaceId={spaceId} onClose={() => setAddTermOpen(false)} />
      )}

      {ConfirmModalElement}
      {owner && addChildOpen && (
        <AddChildModal
          spaceId={spaceId}
          onClose={() => setAddChildOpen(false)}
        />
      )}
    </div>
  );
}

const OFFERING_STATUS_TEXT: Record<OfferingStatus, string> = {
  active: "text-accent",
  draft: "text-text-muted",
  archived: "text-text-muted line-through",
};

function formatOfferingRange(offering: Offering): string | null {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
  };
  const start = offering.starts_at ? fmt(offering.starts_at) : null;
  const end = offering.ends_at ? fmt(offering.ends_at) : null;
  if (start && end) return `${start} – ${end}`;
  return start ?? end;
}

function OfferingRow({
  offering,
  owner,
  onRemove,
}: {
  offering: Offering;
  owner: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const range = formatOfferingRange(offering);
  return (
    <li className="group flex items-center gap-3 rounded-panel bg-bg-tertiary p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent/10 text-accent">
        <CalendarDays size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text-primary">
          {offering.term_label}
        </span>
        {range && (
          <span className="block truncate text-2xs text-text-muted">
            {range}
          </span>
        )}
      </span>
      <span
        className={cn(
          chipClass,
          "shrink-0 text-2xs font-medium",
          OFFERING_STATUS_TEXT[offering.status],
        )}
      >
        {t(`spaces.offeringStatus.${offering.status}`, {
          defaultValue: offering.status,
        })}
      </span>
      {owner && (
        <IconButton
          size="sm"
          onClick={onRemove}
          aria-label={t("spaces.removeTerm")}
          className="opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={15} />
        </IconButton>
      )}
    </li>
  );
}

function AddTermModal({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const addOffering = useSpaceStore((s) => s.addOffering);
  const [termLabel, setTermLabel] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState<OfferingStatus>("active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!termLabel.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addOffering({
        spaceId,
        termLabel: termLabel.trim(),
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        status,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add term.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title={t("spaces.addTerm")}
      icon={CalendarDays}
      onSubmit={() => void handleSubmit()}
      submitLabel={t("spaces.addTerm")}
      submitting={saving}
      submitDisabled={!termLabel.trim()}
    >
      <div>
        <label
          htmlFor="term-label"
          className="mb-1 block text-sm font-medium text-text-secondary"
        >
          {t("spaces.termLabel")}
        </label>
        <input
          id="term-label"
          value={termLabel}
          onChange={(e) => setTermLabel(e.target.value)}
          placeholder="2025 ősz"
          disabled={saving}
          className="field"
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="term-starts"
            className="mb-1 block text-sm font-medium text-text-secondary"
          >
            {t("spaces.termStarts")}
          </label>
          <input
            id="term-starts"
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            disabled={saving}
            className="field"
          />
        </div>
        <div>
          <label
            htmlFor="term-ends"
            className="mb-1 block text-sm font-medium text-text-secondary"
          >
            {t("spaces.termEnds")}
          </label>
          <input
            id="term-ends"
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            disabled={saving}
            className="field"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-text-secondary">
          {t("spaces.termStatus")}
        </label>
        <Select
          value={status}
          onChange={setStatus}
          options={OFFERING_STATUSES.map((s) => ({
            value: s,
            label: t(`spaces.offeringStatus.${s}`, { defaultValue: s }),
          }))}
          disabled={saving}
          ariaLabel={t("spaces.termStatus")}
        />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </FormModal>
  );
}

function AddChildModal({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createSpace = useSpaceStore((s) => s.createSpace);
  const loadSpace = useSpaceStore((s) => s.loadSpace);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SpaceKind>("course");
  const [visibility, setVisibility] = useState<SpaceVisibility>("public");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createSpace({
        name: name.trim(),
        kind,
        visibility,
        parentId: spaceId,
      });
      await loadSpace(spaceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create space.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title={t("spaces.addChild")}
      icon={Shapes}
      onSubmit={() => void handleSubmit()}
      submitLabel={t("spaces.addChild")}
      submitting={saving}
      submitDisabled={!name.trim()}
    >
      <div>
        <label
          htmlFor="child-name"
          className="mb-1 block text-sm font-medium text-text-secondary"
        >
          {t("spaces.childName")}
        </label>
        <input
          id="child-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("spaces.childNamePlaceholder")}
          disabled={saving}
          className="field"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-text-secondary">
          {t("spaces.childKind")}
        </label>
        <Select
          value={kind}
          onChange={setKind}
          options={CHILD_KINDS.map((k) => ({
            value: k,
            label: t(`spaces.kind.${k}`, { defaultValue: k }),
          }))}
          disabled={saving}
          ariaLabel={t("spaces.childKind")}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-text-secondary">
          {t("spaces.childVisibility")}
        </label>
        <Select
          value={visibility}
          onChange={setVisibility}
          options={CHILD_VISIBILITIES.map((v) => ({
            value: v,
            label: t(`spaces.visibility.${v}`, { defaultValue: v }),
          }))}
          disabled={saving}
          ariaLabel={t("spaces.childVisibility")}
        />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </FormModal>
  );
}

function AddContentModal({
  spaceId,
  sectionId = null,
  onClose,
}: {
  spaceId: string;
  /** Section the new item lands in; null = the implicit General group. */
  sectionId?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const addSpaceContent = useSpaceStore((s) => s.addSpaceContent);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<SpaceContentKind>("link");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addSpaceContent({
        spaceId,
        kind,
        title: title.trim(),
        url: url.trim() || null,
        sectionId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add content.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title={t("spaces.addContent")}
      icon={Plus}
      onSubmit={() => void handleSubmit()}
      submitLabel={t("spaces.addContent")}
      submitting={saving}
      submitDisabled={!title.trim()}
    >
      <div>
        <label
          htmlFor="content-title"
          className="mb-1 block text-sm font-medium text-text-secondary"
        >
          {t("spaces.contentTitle")}
        </label>
        <input
          id="content-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("spaces.contentTitlePlaceholder")}
          disabled={saving}
          className="field"
          autoComplete="off"
        />
      </div>

      <div>
        <label
          htmlFor="content-url"
          className="mb-1 block text-sm font-medium text-text-secondary"
        >
          {t("spaces.contentUrl")}
        </label>
        <input
          id="content-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          disabled={saving}
          className="field"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-text-secondary">
          {t("spaces.contentKind")}
        </label>
        <Select
          value={kind}
          onChange={setKind}
          options={CONTENT_KINDS.map((k) => ({
            value: k,
            label: t(`spaces.kind.${k}`, { defaultValue: k }),
          }))}
          disabled={saving}
          ariaLabel={t("spaces.contentKind")}
        />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </FormModal>
  );
}
