/**
 * Course files section on CourseSpacePage: the shared "space-files"
 * bucket's listing. Owner uploads/deletes; a member click makes a
 * personal library copy and opens the reader (see space-files.ts).
 * Also exports SpaceInviteSection, a compact card CourseSpacePage pins
 * to the top of the main column for the owner of a non-public space.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Copy,
  FileText,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, IconButton, PromptModal } from "@/components/ui";
import { useSpaceStore } from "@/stores/space-store";
import { showToast } from "@/stores/toast-store";
import { fetchUrlAsFile } from "@/lib/url-to-file";
import {
  deleteSpaceFile,
  listSpaceFiles,
  openSpaceFile,
  uploadSpaceFile,
  type SpaceFile,
} from "./space-files";

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SpaceFilesSection({
  spaceId,
  owner,
  isMember,
}: {
  spaceId: string;
  owner: boolean;
  isMember: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [files, setFiles] = useState<SpaceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlBusy, setUrlBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addSpaceContent = useSpaceStore((s) => s.addSpaceContent);

  const refresh = useCallback(async () => {
    setFiles(await listSpaceFiles(spaceId));
    setLoading(false);
  }, [spaceId]);
  useEffect(() => {
    if (owner || isMember) void refresh();
    else setLoading(false);
  }, [owner, isMember, refresh]);

  const handleUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    for (const file of Array.from(list)) {
      const err = await uploadSpaceFile(spaceId, file);
      if (err) {
        showToast(
          t("spaces.files.uploadFailed", {
            name: file.name,
          }),
          "error",
        );
      }
    }
    await refresh();
  };

  // Paste-a-URL: a downloadable book (PDF/EPUB/…) lands in the shared
  // file store; anything else (YouTube, web page) becomes a link entry
  // in the course content, same as the library's paste behavior.
  const handleAddUrl = async (raw: string) => {
    setUrlBusy(true);
    try {
      const file = await fetchUrlAsFile(raw);
      const err = await uploadSpaceFile(spaceId, file);
      if (err) throw new Error(err);
      await refresh();
      showToast(
        t("spaces.files.urlAdded", {
          name: file.name,
        }),
        "success",
      );
    } catch {
      // not a downloadable file: keep it as a link material instead
      try {
        const u = new URL(raw.trim());
        const title =
          u.hostname.replace(/^www\./, "") +
          (u.pathname !== "/" ? u.pathname : "");
        await addSpaceContent({
          spaceId,
          kind: "link",
          title,
          url: u.toString(),
        });
        showToast(t("spaces.files.urlAddedAsLink"), "success");
      } catch {
        showToast(t("spaces.files.urlFailed"), "error");
      }
    } finally {
      setUrlBusy(false);
    }
  };

  const handleOpen = async (name: string) => {
    setBusyName(name);
    try {
      await openSpaceFile(spaceId, name, navigate);
    } catch {
      showToast(t("spaces.files.openFailed"), "error");
    } finally {
      setBusyName(null);
    }
  };

  if (!owner && !isMember) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
          {t("spaces.files.heading")}
        </h2>
        {owner && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUpload(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-1.5">
              <Button
                variant="soft"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={14} />
                {t("spaces.files.upload")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={urlBusy}
                onClick={() => setUrlOpen(true)}
              >
                {urlBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Link2 size={14} />
                )}
                {t("spaces.files.fromUrl")}
              </Button>
            </div>
          </>
        )}
      </div>
      <PromptModal
        open={urlOpen}
        title={t("spaces.files.fromUrlTitle")}
        body={t("spaces.files.fromUrlBody")}
        placeholder="https://…"
        confirmLabel={t("common.add")}
        onClose={() => setUrlOpen(false)}
        onSubmit={(value) => void handleAddUrl(value)}
      />

      {loading ? (
        <div className="flex justify-center py-6 text-text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : files.length === 0 ? (
        <p className="rounded-panel bg-bg-secondary px-4 py-5 text-center text-xs text-text-muted">
          {t("spaces.files.empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-panel bg-bg-secondary">
          {files.map((f) => (
            <div
              key={f.name}
              // same flat 44px row as the library list (Nextcloud model)
              className="group flex h-[44px] items-center gap-3 border-b border-surface-3/60 px-4 text-sm transition-colors last:border-b-0 hover:bg-bg-tertiary"
            >
              <FileText
                size={18}
                strokeWidth={1.5}
                className="shrink-0 text-text-muted"
              />
              <button
                type="button"
                onClick={() => void handleOpen(f.name)}
                disabled={busyName !== null}
                className="min-w-0 flex-1 truncate text-left font-medium text-text-primary cursor-pointer hover:underline underline-offset-2 disabled:cursor-wait"
                title={f.name}
              >
                {f.name}
              </button>
              {busyName === f.name && (
                <Loader2 size={14} className="animate-spin text-text-muted" />
              )}
              <span className="hidden w-24 shrink-0 truncate text-xs text-text-muted md:block">
                {f.updatedAt ? new Date(f.updatedAt).toLocaleDateString() : ""}
              </span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-text-muted">
                {fmtSize(f.size)}
              </span>
              {owner && (
                <IconButton
                  size="sm"
                  onClick={() => {
                    void deleteSpaceFile(spaceId, f.name).then(refresh);
                  }}
                  aria-label={t("common.delete")}
                  title={t("common.delete")}
                  className="opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}
      {!owner && files.length > 0 && (
        <p className="text-2xs text-text-muted">{t("spaces.files.copyHint")}</p>
      )}
    </section>
  );
}

/** Owner-only invite code block for private/restricted spaces. */
export function SpaceInviteSection({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const activeSpace = useSpaceStore((s) => s.activeSpace);
  const rotateInviteCode = useSpaceStore((s) => s.rotateInviteCode);
  const [busy, setBusy] = useState(false);
  const code = activeSpace?.invite_code ?? null;

  const rotate = async () => {
    setBusy(true);
    try {
      await rotateInviteCode(spaceId);
    } catch {
      showToast(t("spaces.invite.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  // Compact, prominent card for the top of the course page: the owner
  // of a private course needs the code close at hand, not buried below
  // sections and offerings where it used to live.
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-panel border border-glass-border bg-bg-secondary px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">
        <KeyRound size={16} strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-xs font-semibold text-text-primary">
          {t("spaces.invite.heading")}
        </h2>
        <p className="truncate text-2xs text-text-muted">
          {t("spaces.invite.hint")}
        </p>
      </div>
      {code ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <code className="rounded-control bg-bg-tertiary px-3 py-1.5 font-mono text-sm tracking-widest text-text-primary">
            {code}
          </code>
          <IconButton
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(code);
              showToast(t("spaces.invite.copied"), "success");
            }}
            aria-label={t("spaces.invite.copy")}
            title={t("spaces.invite.copy")}
          >
            <Copy size={14} strokeWidth={1.5} />
          </IconButton>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void rotate()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} strokeWidth={1.5} />
            )}
            {t("spaces.invite.rotate")}
          </Button>
        </div>
      ) : (
        <Button
          variant="soft"
          size="sm"
          onClick={() => void rotate()}
          disabled={busy}
          className="shrink-0"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            t("spaces.invite.generate")
          )}
        </Button>
      )}
    </section>
  );
}
