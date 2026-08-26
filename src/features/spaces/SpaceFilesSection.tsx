/**
 * Course files section on CourseSpacePage: the shared "space-files"
 * bucket's listing. Owner uploads/deletes; a member click makes a
 * personal library copy and opens the reader (see space-files.ts).
 * Below it, for the owner of a non-public space: the invite code.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, FileText, Link2, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
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
            defaultValue: "Upload failed: {{name}}",
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
          defaultValue: "Added to course files: {{name}}",
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
        await addSpaceContent({ spaceId, kind: "link", title, url: u.toString() });
        showToast(
          t("spaces.files.urlAddedAsLink", {
            defaultValue: "Added as a link under course content.",
          }),
          "success",
        );
      } catch {
        showToast(
          t("spaces.files.urlFailed", {
            defaultValue: "Couldn't add that URL.",
          }),
          "error",
        );
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
      showToast(
        t("spaces.files.openFailed", {
          defaultValue: "Couldn't open the file.",
        }),
        "error",
      );
    } finally {
      setBusyName(null);
    }
  };

  if (!owner && !isMember) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
          {t("spaces.files.heading", { defaultValue: "Course files" })}
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
                {t("spaces.files.upload", { defaultValue: "Upload" })}
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
                {t("spaces.files.fromUrl", { defaultValue: "From URL" })}
              </Button>
            </div>
          </>
        )}
      </div>
      <PromptModal
        open={urlOpen}
        title={t("spaces.files.fromUrlTitle", { defaultValue: "Add from URL" })}
        body={t("spaces.files.fromUrlBody", {
          defaultValue:
            "A PDF/EPUB link becomes a course file; a web page or YouTube link is saved under course content.",
        })}
        placeholder="https://…"
        confirmLabel={t("common.add", { defaultValue: "Add" })}
        onClose={() => setUrlOpen(false)}
        onSubmit={(value) => void handleAddUrl(value)}
      />

      {loading ? (
        <div className="flex justify-center py-6 text-text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : files.length === 0 ? (
        <p className="rounded-panel bg-bg-secondary px-4 py-5 text-center text-xs text-text-muted">
          {t("spaces.files.empty", {
            defaultValue: "No files yet. The course owner can upload materials here.",
          })}
        </p>
      ) : (
        <div className="overflow-hidden rounded-panel bg-bg-secondary">
          {files.map((f) => (
            <div
              key={f.name}
              className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-bg-tertiary"
            >
              <FileText size={16} strokeWidth={1.5} className="shrink-0 text-text-muted" />
              <button
                type="button"
                onClick={() => void handleOpen(f.name)}
                disabled={busyName !== null}
                className="min-w-0 flex-1 truncate text-left text-sm text-text-primary cursor-pointer hover:underline underline-offset-2 disabled:cursor-wait"
                title={f.name}
              >
                {f.name}
              </button>
              {busyName === f.name && (
                <Loader2 size={14} className="animate-spin text-text-muted" />
              )}
              <span className="shrink-0 text-2xs tabular-nums text-text-muted">
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
        <p className="text-2xs text-text-muted">
          {t("spaces.files.copyHint", {
            defaultValue:
              "Opening a file saves a personal copy to your library, your notes and progress live there.",
          })}
        </p>
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
      showToast(
        t("spaces.invite.failed", { defaultValue: "Couldn't generate a code." }),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
        {t("spaces.invite.heading", { defaultValue: "Invite" })}
      </h2>
      <div className="flex flex-wrap items-center gap-2 rounded-panel bg-bg-secondary px-4 py-3">
        {code ? (
          <>
            <code className="rounded-control bg-bg-tertiary px-3 py-1.5 font-mono text-sm tracking-widest text-text-primary">
              {code}
            </code>
            <IconButton
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(code);
                showToast(
                  t("spaces.invite.copied", { defaultValue: "Code copied." }),
                  "success",
                );
              }}
              aria-label={t("spaces.invite.copy", { defaultValue: "Copy code" })}
              title={t("spaces.invite.copy", { defaultValue: "Copy code" })}
            >
              <Copy size={14} strokeWidth={1.5} />
            </IconButton>
            <IconButton
              size="sm"
              onClick={() => void rotate()}
              aria-label={t("spaces.invite.rotate", { defaultValue: "New code" })}
              title={t("spaces.invite.rotate", { defaultValue: "New code" })}
            >
              <RefreshCw size={14} strokeWidth={1.5} className={busy ? "animate-spin" : undefined} />
            </IconButton>
            <span className="w-full text-2xs text-text-muted sm:w-auto">
              {t("spaces.invite.hint", {
                defaultValue:
                  "Members enter this code on the Spaces page to join.",
              })}
            </span>
          </>
        ) : (
          <Button variant="soft" size="sm" onClick={() => void rotate()} disabled={busy}>
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              t("spaces.invite.generate", { defaultValue: "Generate invite code" })
            )}
          </Button>
        )}
      </div>
    </section>
  );
}
