import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Apple,
  Monitor,
  Terminal,
  Smartphone,
  ExternalLink,
  Loader2,
  AlertCircle,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

const REPO = "LenYx24/pnyxy";
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

type OsKey = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

interface PackageAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
interface PackageRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  assets: PackageAsset[];
}

interface PlatformDownload {
  os: OsKey;
  /** The installer file names we care about for this platform. */
  matcher: (name: string) => boolean;
  /** Short label for the button, "Download for Windows" etc. */
  labelKey: string;
  fileLabelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const PLATFORMS: PlatformDownload[] = [
  {
    os: "windows",
    matcher: (n) => /\.(msi|exe)$/i.test(n),
    labelKey: "download.platforms.windows.title",
    fileLabelKey: "download.platforms.windows.file",
    icon: Monitor,
  },
  {
    os: "macos",
    matcher: (n) => /\.dmg$/i.test(n),
    labelKey: "download.platforms.macos.title",
    fileLabelKey: "download.platforms.macos.file",
    icon: Apple,
  },
  {
    os: "linux",
    matcher: (n) => /\.(appimage|deb|rpm)$/i.test(n),
    labelKey: "download.platforms.linux.title",
    fileLabelKey: "download.platforms.linux.file",
    icon: Terminal,
  },
];

function detectOs(): OsKey {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Mac/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 100 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

export function DownloadPage() {
  const { t } = useTranslation();
  const [release, setRelease] = useState<PackageRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const detectedOs = useMemo(() => detectOs(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(LATEST_API)
      .then(async (res) => {
        if (res.status === 404) throw new Error("no-release");
        if (!res.ok) throw new Error(`http-${res.status}`);
        return (await res.json()) as PackageRelease;
      })
      .then((data) => {
        if (cancelled) return;
        setRelease(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "unknown");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Group assets by platform so each card can show all matching
  // installers (Linux has .AppImage AND .deb for example).
  const assetsByOs = useMemo(() => {
    const map = new Map<OsKey, PackageAsset[]>();
    if (!release) return map;
    for (const p of PLATFORMS) {
      map.set(
        p.os,
        release.assets.filter((a) => p.matcher(a.name)),
      );
    }
    return map;
  }, [release]);

  const primaryPlatform = PLATFORMS.find((p) => p.os === detectedOs) ?? null;
  const otherPlatforms = PLATFORMS.filter(
    (p) => !primaryPlatform || p.os !== primaryPlatform.os,
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <Download size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("download.title")}
          </h1>
          {release && (
            <p className="text-xs text-text-muted">
              {t("download.version", { tag: release.tag_name })} ·{" "}
              {new Date(release.published_at).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" />
          {t("download.loading")}
        </div>
      )}

      {error === "no-release" && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{t("download.noReleaseTitle")}</p>
            <p className="mt-1 text-xs text-warning/80">
              {t("download.noReleaseBody")}
            </p>
            <a
              href={RELEASES_PAGE}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Package size={12} />
              {t("download.viewOnPackage")}
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}

      {error && error !== "no-release" && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{t("download.errorTitle")}</p>
            <p className="mt-1 text-xs text-danger/80">
              {t("download.errorBody")}
            </p>
            <a
              href={RELEASES_PAGE}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Package size={12} />
              {t("download.viewOnPackage")}
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}

      {release && (
        <>
          {/* Primary card — detected OS gets the spotlight */}
          {primaryPlatform && (
            <PlatformCard
              platform={primaryPlatform}
              assets={assetsByOs.get(primaryPlatform.os) ?? []}
              primary
            />
          )}

          {/* Detected something we can't ship to (android/ios/unknown) — tell the user */}
          {!primaryPlatform && detectedOs === "android" && (
            <MobileNoticeCard os="android" />
          )}
          {!primaryPlatform && detectedOs === "ios" && (
            <MobileNoticeCard os="ios" />
          )}

          {/* Secondary grid — "other platforms" */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              {primaryPlatform
                ? t("download.otherPlatforms")
                : t("download.allPlatforms")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {otherPlatforms.map((p) => (
                <PlatformCard
                  key={p.os}
                  platform={p}
                  assets={assetsByOs.get(p.os) ?? []}
                />
              ))}
            </div>
          </section>

          {/* Footer note about signing */}
          <div className="rounded-xl border border-glass-border bg-glass-bg/40 p-4 text-xs text-text-muted">
            <p>{t("download.unsignedNotice")}</p>
          </div>

          {/* Source code link */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <a
              href={release.html_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-text-primary"
            >
              <Package size={14} />
              {t("download.viewReleaseNotes")}
              <ExternalLink size={12} />
            </a>
            <a
              href={`https://github.com/${REPO}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-text-primary"
            >
              <Package size={14} />
              {t("download.sourceCode")}
              <ExternalLink size={12} />
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function PlatformCard({
  platform,
  assets,
  primary,
}: {
  platform: PlatformDownload;
  assets: PackageAsset[];
  primary?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = platform.icon;

  const empty = assets.length === 0;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        primary
          ? "border-accent/40 bg-accent/5 p-5 sm:p-6"
          : "border-glass-border bg-glass-bg/40",
        empty && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            primary
              ? "bg-accent/15 text-accent"
              : "bg-glass-bg text-text-secondary",
          )}
        >
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "font-semibold text-text-primary",
              primary ? "text-lg" : "text-sm",
            )}
          >
            {t(platform.labelKey)}
          </h3>
          <p
            className={cn(
              "text-text-muted",
              primary ? "text-sm" : "text-xs",
            )}
          >
            {t(platform.fileLabelKey)}
          </p>
        </div>
      </div>

      <div className={cn("mt-3 space-y-2", primary && "mt-4")}>
        {empty && (
          <p className="text-xs text-text-muted">
            {t("download.noAssetsForPlatform")}
          </p>
        )}
        {assets.map((a) => (
          <a
            key={a.name}
            href={a.browser_download_url}
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg border border-glass-border bg-bg-secondary/40 px-3 py-2 text-sm transition-colors hover:border-accent/40 hover:bg-glass-hover",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-text-primary">
              {assetLabel(a.name)}
            </span>
            <span className="shrink-0 text-xs text-text-muted">
              {formatSize(a.size)}
            </span>
            <Download size={14} className="shrink-0 text-accent" />
          </a>
        ))}
      </div>

      {primary && !empty && (
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              window.location.href = assets[0].browser_download_url;
            }}
            className="gap-2"
          >
            <Download size={16} />
            {t("download.quickDownload")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Strip the common prefix so the user sees ".AppImage" not
 *  "Pnyxy-Reader_0.1.0_amd64.AppImage". */
function assetLabel(name: string): string {
  const ext = name.match(/\.(AppImage|deb|rpm|dmg|msi|exe)$/i);
  if (!ext) return name;
  return `.${ext[1]}`;
}

function MobileNoticeCard({ os }: { os: "android" | "ios" }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-glass-border bg-glass-bg/40 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-glass-bg text-text-secondary">
        <Smartphone size={20} />
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <h3 className="font-semibold text-text-primary">
          {t(`download.mobile.${os}.title`)}
        </h3>
        <p className="mt-1 text-xs text-text-muted">
          {t(`download.mobile.${os}.body`)}
        </p>
      </div>
    </div>
  );
}
