import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  ListChecks,
  Loader2,
  Map as MapIcon,
  MessagesSquare,
  Plus,
  Shapes,
  Sparkles,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore } from "@/stores/chat-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSpaceStore } from "@/stores/space-store";
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

const KIND_ICON: Record<SpaceContentKind, LucideIcon> = {
  book: BookOpen,
  resource: Globe,
  quiz: ListChecks,
  roadmap: MapIcon,
  note: FileText,
  whiteboard: Shapes,
  link: Globe,
};

/** Internal route for a content item by kind (when no external url is set). */
function internalHref(item: SpaceContent): string | null {
  if (!item.ref_id) return null;
  switch (item.kind) {
    case "book":
      return `/reader/${item.ref_id}`;
    case "resource":
      return `/resources/${item.ref_id}`;
    case "quiz":
      return `/quizzes/${item.ref_id}`;
    case "roadmap":
      return `/roadmaps/${item.ref_id}`;
    case "note":
      return `/notes/${item.ref_id}`;
    case "whiteboard":
      return `/whiteboards/${item.ref_id}`;
    default:
      return null;
  }
}

const isExternal = (url: string) => /^https?:\/\//i.test(url);

export function CourseSpacePage() {
  const { t } = useTranslation();
  const { spaceId } = useParams<{ spaceId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const {
    activeSpace,
    activeSpaceChildren,
    activeSpaceContent,
    activeSpaceOfferings,
    loading,
    memberIds,
    loadSpace,
    leaveSpace,
    enrollInCourse,
    removeSpaceContent,
    removeOffering,
  } = useSpaceStore();
  const folders = useChatStore((s) => s.folders);

  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addTermOpen, setAddTermOpen] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);

  useEffect(() => {
    if (spaceId) void loadSpace(spaceId);
  }, [spaceId, loadSpace]);

  // Load the user's library folders so enrolled resources can map to their study folder.
  useEffect(() => {
    if (spaceId && memberIds.has(spaceId)) {
      void useChatStore.getState().fetchFolders();
    }
  }, [spaceId, memberIds]);

  if (loading || !spaceId) {
    return (
      <div className="flex items-center justify-center py-24 text-text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!activeSpace) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 text-center sm:p-6">
        <p className="text-text-secondary">
          {t("spaces.notFound", { defaultValue: "This space could not be found." })}
        </p>
        <Link to="/spaces">
          <Button variant="secondary" size="sm">
            <ArrowLeft size={14} />
            {t("spaces.back", { defaultValue: "Back to spaces" })}
          </Button>
        </Link>
      </div>
    );
  }

  const owner = !!user && activeSpace.owner_id === user.id;
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
            f.name.trim().toLowerCase() === item.title.slice(0, 120).trim().toLowerCase(),
        )
      : undefined;

  const openItem = (item: SpaceContent) => {
    // Prefer an explicit url for link / resource items.
    if (item.url && (item.kind === "link" || item.kind === "resource")) {
      if (isExternal(item.url)) window.open(item.url, "_blank", "noopener,noreferrer");
      else navigate(item.url);
      return;
    }
    const href = internalHref(item);
    if (href) {
      navigate(href);
      return;
    }
    if (item.url) {
      if (isExternal(item.url)) window.open(item.url, "_blank", "noopener,noreferrer");
      else navigate(item.url);
    }
  };

  const askAi = () => {
    const materials = activeSpaceContent.map((c) => `- ${c.title}`).join("\n");
    const seedPrompt =
      t("spaces.askAiSeedIntro", {
        defaultValue: `I'm studying the course "${activeSpace.name}". Its materials are:`,
        name: activeSpace.name,
      }) +
      "\n" +
      materials +
      "\n\n" +
      t("spaces.askAiSeedOutro", {
        defaultValue:
          "Act as a focused tutor for this course. Help me study these topics, quiz me, and explain concepts. Where should I start?",
      });
    useChatStore.getState().setPendingDraft({ text: seedPrompt });
    navigate("/chat");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {/* Back + beta */}
      <div className="flex items-center justify-between">
        <Link
          to="/spaces"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          {t("spaces.back", { defaultValue: "Back to spaces" })}
        </Link>
        <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-2xs uppercase tracking-wide text-accent">
          {t("spaces.beta", { defaultValue: "Beta" })}
        </span>
      </div>

      {/* Header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="flex items-center gap-1.5 text-2xl font-bold text-text-primary">
            <span className="break-words">{activeSpace.name}</span>
            {activeSpace.official && (
              <BadgeCheck size={20} className="shrink-0 text-accent" aria-label="Official" />
            )}
          </h1>
          {owner ? (
            <span className="rounded-full border border-glass-border bg-glass-bg px-2 py-0.5 text-2xs font-medium text-text-secondary">
              {t("spaces.ownerChip", { defaultValue: "Owner" })}
            </span>
          ) : (
            <Button
              variant={isMember ? "secondary" : "soft"}
              size="sm"
              onClick={handleEnroll}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : isMember ? (
                t("spaces.leaveCourse", { defaultValue: "Leave course" })
              ) : (
                t("spaces.enroll", { defaultValue: "Enroll" })
              )}
            </Button>
          )}
        </div>

        <p className="font-mono text-2xs uppercase tracking-wide text-text-muted">
          {t(`spaces.kind.${activeSpace.kind}`, { defaultValue: activeSpace.kind })}
          {activeSpace.visibility !== "public" &&
            ` · ${t(`spaces.visibility.${activeSpace.visibility}`, { defaultValue: activeSpace.visibility })}`}
        </p>

        {activeSpace.description && (
          <p className="text-sm text-text-secondary">{activeSpace.description}</p>
        )}
      </header>

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="soft" size="sm" onClick={askAi}>
          <Sparkles size={14} />
          {t("spaces.askAi", { defaultValue: "Ask AI about this course" })}
        </Button>
        <Link to={`/spaces/${spaceId}/gallery`}>
          <Button variant="secondary" size="sm">
            <MessagesSquare size={14} />
            {t("spaces.sharedAnswers", { defaultValue: "Shared answers" })}
          </Button>
        </Link>
        {owner && (
          <Button variant="soft" size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} />
            {t("spaces.addContent", { defaultValue: "Add content" })}
          </Button>
        )}
      </div>

      {/* Child spaces / courses */}
      {(owner || activeSpaceChildren.length > 0) && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("spaces.childrenHeading", { defaultValue: "Courses & spaces" })}
            </h2>
            {owner && (
              <Button variant="soft" size="sm" onClick={() => setAddChildOpen(true)}>
                <Plus size={14} />
                {t("spaces.addChild", { defaultValue: "New space" })}
              </Button>
            )}
          </div>
          {activeSpaceChildren.length === 0 ? (
            owner ? (
              <p className="text-sm text-text-muted">
                {t("spaces.childrenEmptyOwner", {
                  defaultValue: "No nested spaces yet — add a course or topic under this space.",
                })}
              </p>
            ) : null
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {activeSpaceChildren.map((child) => (
                <div
                  key={child.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/spaces/${child.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/spaces/${child.id}`);
                    }
                  }}
                  className="group flex cursor-pointer flex-col gap-1 rounded-xl border border-glass-border bg-bg-secondary p-3 text-left transition-colors hover:border-accent/40"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
                      {child.name}
                    </span>
                    {child.official && (
                      <BadgeCheck
                        size={15}
                        className="shrink-0 text-accent"
                        aria-label="Official"
                      />
                    )}
                  </span>
                  <span className="font-mono text-2xs uppercase tracking-wide text-text-muted">
                    {t(`spaces.kind.${child.kind}`, { defaultValue: child.kind })}
                  </span>
                  {child.description && (
                    <span className="line-clamp-2 text-2xs text-text-secondary">
                      {child.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Offerings / terms */}
      {(owner || activeSpaceOfferings.length > 0) && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("spaces.offeringsHeading", { defaultValue: "Terms" })}
            </h2>
            {owner && (
              <Button variant="soft" size="sm" onClick={() => setAddTermOpen(true)}>
                <Plus size={14} />
                {t("spaces.addTerm", { defaultValue: "Add term" })}
              </Button>
            )}
          </div>
          {activeSpaceOfferings.length === 0 ? (
            owner ? (
              <p className="text-sm text-text-muted">
                {t("spaces.offeringsEmptyOwner", {
                  defaultValue: "No terms yet — add one to show when this course runs.",
                })}
              </p>
            ) : null
          ) : (
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
          )}
        </section>
      )}

      {/* Content list */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text-primary">
          {t("spaces.contentHeading", { defaultValue: "Course content" })}
        </h2>
        {activeSpaceContent.length === 0 ? (
          <p className="text-sm text-text-muted">
            {owner
              ? t("spaces.contentEmptyOwner", {
                  defaultValue: "No content yet — add books, quizzes, or links to build the course.",
                })
              : t("spaces.contentEmpty", { defaultValue: "No content has been added yet." })}
          </p>
        ) : (
          <ul className="space-y-2">
            {activeSpaceContent.map((item) => {
              const Icon = KIND_ICON[item.kind] ?? Video;
              const studyFolder = isMember ? folderForItem(item) : undefined;
              const openPrimary = () => {
                if (studyFolder) {
                  useLibraryStore.getState().navigateToFolder(studyFolder.id);
                  navigate("/library");
                  return;
                }
                openItem(item);
              };
              return (
                <li
                  key={item.id}
                  className="group flex items-center gap-3 rounded-xl border border-glass-border bg-bg-secondary p-3 transition-colors hover:border-accent/40"
                >
                  <button
                    type="button"
                    onClick={openPrimary}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-text-primary">
                        {item.title}
                      </span>
                      <span className="flex items-center gap-1 truncate text-2xs text-text-muted">
                        {studyFolder && <Folder size={11} className="shrink-0 text-accent" />}
                        <span className="truncate">
                          {studyFolder
                            ? t("spaces.openStudyFolder", {
                                defaultValue: "Open study folder",
                              })
                            : item.subtitle ||
                              t(`spaces.kind.${item.kind}`, { defaultValue: item.kind })}
                        </span>
                      </span>
                    </span>
                  </button>
                  {item.url && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(item.url!, "_blank", "noopener,noreferrer");
                      }}
                      className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-accent/10 hover:text-accent cursor-pointer"
                      aria-label={t("spaces.openSource", { defaultValue: "Open source" })}
                      title={t("spaces.openSource", { defaultValue: "Open source" })}
                    >
                      <ExternalLink size={15} />
                    </button>
                  )}
                  {owner && (
                    <button
                      type="button"
                      onClick={() => void removeSpaceContent(item.id)}
                      className="shrink-0 rounded-lg p-1.5 text-text-muted opacity-0 transition-all hover:bg-danger/15 hover:text-danger group-hover:opacity-100 cursor-pointer"
                      aria-label={t("spaces.removeContent", { defaultValue: "Remove" })}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {owner && addOpen && (
        <AddContentModal spaceId={spaceId} onClose={() => setAddOpen(false)} />
      )}

      {owner && addTermOpen && (
        <AddTermModal spaceId={spaceId} onClose={() => setAddTermOpen(false)} />
      )}

      {owner && addChildOpen && (
        <AddChildModal spaceId={spaceId} onClose={() => setAddChildOpen(false)} />
      )}
    </div>
  );
}

const STATUS_CHIP: Record<OfferingStatus, string> = {
  active: "border-accent/30 bg-accent/10 text-accent",
  draft: "border-glass-border bg-glass-bg text-text-muted",
  archived: "border-glass-border bg-glass-bg text-text-muted line-through",
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
    <li className="group flex items-center gap-3 rounded-xl border border-glass-border bg-bg-secondary p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <CalendarDays size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text-primary">
          {offering.term_label}
        </span>
        {range && <span className="block truncate text-2xs text-text-muted">{range}</span>}
      </span>
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium ${STATUS_CHIP[offering.status]}`}
      >
        {t(`spaces.offeringStatus.${offering.status}`, { defaultValue: offering.status })}
      </span>
      {owner && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-lg p-1.5 text-text-muted opacity-0 transition-all hover:bg-danger/15 hover:text-danger group-hover:opacity-100 cursor-pointer"
          aria-label={t("spaces.removeTerm", { defaultValue: "Remove term" })}
        >
          <Trash2 size={15} />
        </button>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={saving ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <CalendarDays size={16} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("spaces.addTerm", { defaultValue: "Add term" })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label
              htmlFor="term-label"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("spaces.termLabel", { defaultValue: "Term" })}
            </label>
            <input
              id="term-label"
              autoFocus
              value={termLabel}
              onChange={(e) => setTermLabel(e.target.value)}
              placeholder="2025 ősz"
              disabled={saving}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="term-starts"
                className="mb-1 block text-sm font-medium text-text-secondary"
              >
                {t("spaces.termStarts", { defaultValue: "Starts (optional)" })}
              </label>
              <input
                id="term-starts"
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="term-ends"
                className="mb-1 block text-sm font-medium text-text-secondary"
              >
                {t("spaces.termEnds", { defaultValue: "Ends (optional)" })}
              </label>
              <input
                id="term-ends"
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="term-status"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("spaces.termStatus", { defaultValue: "Status" })}
            </label>
            <select
              id="term-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as OfferingStatus)}
              disabled={saving}
              className="w-full cursor-pointer rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
            >
              {OFFERING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`spaces.offeringStatus.${s}`, { defaultValue: s })}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" disabled={saving || !termLabel.trim()}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t("spaces.addTerm", { defaultValue: "Add term" })}
            </Button>
          </div>
        </form>
      </div>
    </div>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createSpace({ name: name.trim(), kind, visibility, parentId: spaceId });
      await loadSpace(spaceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create space.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={saving ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <Shapes size={16} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("spaces.addChild", { defaultValue: "New space" })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label
              htmlFor="child-name"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("spaces.childName", { defaultValue: "Name" })}
            </label>
            <input
              id="child-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("spaces.childNamePlaceholder", {
                defaultValue: "e.g. Matek felkészítő",
              })}
              disabled={saving}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
              autoComplete="off"
            />
          </div>

          <div>
            <label
              htmlFor="child-kind"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("spaces.childKind", { defaultValue: "Kind" })}
            </label>
            <select
              id="child-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as SpaceKind)}
              disabled={saving}
              className="w-full cursor-pointer rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
            >
              {CHILD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`spaces.kind.${k}`, { defaultValue: k })}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="child-visibility"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("spaces.childVisibility", { defaultValue: "Visibility" })}
            </label>
            <select
              id="child-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as SpaceVisibility)}
              disabled={saving}
              className="w-full cursor-pointer rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
            >
              {CHILD_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(`spaces.visibility.${v}`, { defaultValue: v })}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t("spaces.addChild", { defaultValue: "New space" })}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddContentModal({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const addSpaceContent = useSpaceStore((s) => s.addSpaceContent);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<SpaceContentKind>("link");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addSpaceContent({
        spaceId,
        kind,
        title: title.trim(),
        url: url.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add content.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={saving ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <Plus size={16} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("spaces.addContent", { defaultValue: "Add content" })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label
              htmlFor="content-title"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("spaces.contentTitle", { defaultValue: "Title" })}
            </label>
            <input
              id="content-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("spaces.contentTitlePlaceholder", {
                defaultValue: "e.g. Intro lecture video",
              })}
              disabled={saving}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
              autoComplete="off"
            />
          </div>

          <div>
            <label
              htmlFor="content-url"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("spaces.contentUrl", { defaultValue: "URL (optional)" })}
            </label>
            <input
              id="content-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              disabled={saving}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
              autoComplete="off"
            />
          </div>

          <div>
            <label
              htmlFor="content-kind"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("spaces.contentKind", { defaultValue: "Kind" })}
            </label>
            <select
              id="content-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as SpaceContentKind)}
              disabled={saving}
              className="w-full cursor-pointer rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
            >
              {CONTENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`spaces.kind.${k}`, { defaultValue: k })}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t("spaces.addContent", { defaultValue: "Add content" })}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
