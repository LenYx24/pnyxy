import { useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  GraduationCap,
  LogIn,
  Plus,
  Settings as SettingsIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useFeatures } from "@/lib/use-features";
import { useAuthStore } from "@/stores/auth-store";
import { useReaderStore } from "@/stores/reader-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { FloatingMenu, Tooltip } from "@/components/ui";
import { visibleSidebarItems, type NavItem } from "@/lib/navigation";

/** Icon size + stroke for every glyph in the chrome (UI v2). */
const ICON = { size: 18, strokeWidth: 1.5 } as const;

/**
 * Shared nav model for the desktop rail and the mobile drawer. The
 * expand/collapse toggle is gone: on desktop the 56 px icon rail is the
 * only mode (the `sidebarCollapsed` store field still exists, the reader
 * uses it to hide the rail entirely).
 */
function useNavModel() {
  const { user, profile } = useAuthStore();
  const hasActiveBook = useReaderStore(
    (s) => s.activeDocumentId !== null && s.documents.has(s.activeDocumentId),
  );
  const isAdmin = profile?.role === "admin";
  const features = useFeatures();
  const allItems = visibleSidebarItems({
    hasActiveBook,
    isAdmin,
    isAuthed: !!user,
    features,
  });
  const initial = (
    profile?.display_name?.[0] ??
    user?.email?.[0] ??
    "?"
  ).toUpperCase();
  return {
    user,
    profile,
    initial,
    primaryItems: allItems.filter((i) => i.group === "primary"),
    studyItems: allItems.filter((i) => i.group === "study"),
    profileGroupItems: allItems.filter((i) => i.group === "profile"),
  };
}

/** Hover-open flyout state with a short close delay so the pointer can
 *  travel from the trigger to the portaled menu without it snapping shut. */
function useFlyout() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNow = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };
  return { open, setOpen, openNow, scheduleClose };
}

/* ---------------------------------------------------------------- */
/* Desktop: 56 px icon rail                                          */
/* ---------------------------------------------------------------- */

const railItemClass =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-control transition-colors cursor-pointer";
const railInactive =
  "text-text-muted hover:bg-glass-hover hover:text-text-primary";
const railActive = "bg-bg-tertiary text-text-primary";

/** Rail item key -> shortcut catalog id shown as Kbd chips in its tooltip. */
const RAIL_SHORTCUTS: Record<string, string> = {
  library: "app:open-book",
  chat: "app:new-chat",
};

/** Hover-prewarm of route chunks: the specifiers match router.tsx's lazy()
 *  imports, so Vite hands back the same chunk and the click after the
 *  hover mounts without a network wait. Failures are irrelevant here,
 *  the router's lazyWithRetry still owns the real load. */
const RAIL_PRELOADS: Record<string, () => void> = {
  library: () => void import("@/features/library/LibraryPage").catch(() => {}),
  streaks: () => void import("@/features/streaks/StreaksPage").catch(() => {}),
  settings: () =>
    void import("@/features/settings/SettingsPage").catch(() => {}),
};

function RailLink({ item, label }: { item: NavItem; label: string }) {
  const Icon = item.icon;
  return (
    <Tooltip label={label} shortcut={RAIL_SHORTCUTS[item.key]}>
      <NavLink
        to={item.to}
        onPointerEnter={RAIL_PRELOADS[item.key]}
        // exact match: without `end` NavLink prefix-matches and /quizzes
        // stays highlighted on /quizzes/review
        end
        aria-label={label}
        className={({ isActive }) =>
          cn(railItemClass, isActive ? railActive : railInactive)
        }
      >
        <Icon {...ICON} />
      </NavLink>
    </Tooltip>
  );
}

function StudyRailPopover({
  items,
  label,
}: {
  items: NavItem[];
  label: string;
}) {
  const { t } = useTranslation();
  const btnRef = useRef<HTMLButtonElement>(null);
  const fly = useFlyout();
  return (
    <>
      <Tooltip label={label}>
        <button
          ref={btnRef}
          type="button"
          onClick={fly.openNow}
          onMouseEnter={fly.openNow}
          onMouseLeave={fly.scheduleClose}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={fly.open}
          className={cn(railItemClass, fly.open ? railActive : railInactive)}
        >
          <GraduationCap {...ICON} />
        </button>
      </Tooltip>
      <FloatingMenu
        open={fly.open}
        anchorRef={btnRef}
        placement="right"
        onClose={() => fly.setOpen(false)}
        onMouseEnter={fly.openNow}
        onMouseLeave={fly.scheduleClose}
        className="min-w-[12rem] px-1"
      >
        <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </div>
        {items.map((studyItem) => {
          const StudyIcon = studyItem.icon;
          return (
            <NavLink
              key={studyItem.to}
              to={studyItem.to}
              end
              role="menuitem"
              onClick={() => fly.setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )
              }
            >
              <StudyIcon size={18} strokeWidth={1.5} className="shrink-0" />
              <span className="whitespace-nowrap">
                {t(`sidebar.${studyItem.key}`)}
              </span>
            </NavLink>
          );
        })}
      </FloatingMenu>
    </>
  );
}

function Rail() {
  const { t } = useTranslation();
  const {
    user,
    profile,
    initial,
    primaryItems,
    studyItems,
    profileGroupItems,
  } = useNavModel();

  return (
    <>
      {/* logo mark, also the home link */}
      <Tooltip label={t("sidebar.home")}>
        <NavLink
          to="/"
          aria-label={t("sidebar.home")}
          className="mb-2.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center"
        >
          <img src="/logo.svg" alt="" className="h-[26px] w-[26px]" />
        </NavLink>
      </Tooltip>

      {/* Quick-chat CTA: the zero-setup entry point ("I want to learn
          about this video…"). Same as Ctrl+Shift+O. */}
      <QuickChatCta className="mb-3" />

      <nav className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {primaryItems.map((item) => (
          <div key={item.to} className="contents">
            <RailLink item={item} label={t(`sidebar.${item.key}`)} />
            {/* study group sits right below Chat, gated on having items */}
            {item.key === "chat" && studyItems.length > 0 && (
              <StudyRailPopover items={studyItems} label={t("sidebar.study")} />
            )}
          </div>
        ))}
      </nav>

      <div className="flex flex-col items-center gap-2">
        {profileGroupItems.map((item) => (
          <RailLink
            key={item.to}
            item={item}
            label={t(`sidebar.${item.key}`)}
          />
        ))}
        {/* the org switcher moved out of the rail: the library
            breadcrumb mounts OrgSwitcherPopover instead */}
        {user ? (
          <>
            <Tooltip label={t("sidebar.settings")} shortcut="app:open-settings">
              <NavLink
                to="/settings"
                onPointerEnter={RAIL_PRELOADS.settings}
                aria-label={t("sidebar.settings")}
                className={({ isActive }) =>
                  cn(railItemClass, isActive ? railActive : railInactive)
                }
              >
                <SettingsIcon {...ICON} />
              </NavLink>
            </Tooltip>
            <Tooltip label={profile?.display_name || t("sidebar.profile")}>
              <NavLink
                to="/profile"
                aria-label={t("sidebar.profile")}
                className={({ isActive }) =>
                  cn(
                    railItemClass,
                    isActive ? railActive : "hover:bg-glass-hover",
                  )
                }
              >
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-text-primary">
                    {initial}
                  </span>
                )}
              </NavLink>
            </Tooltip>
          </>
        ) : (
          <Tooltip label={t("sidebar.signIn")}>
            <NavLink
              to="/auth"
              aria-label={t("sidebar.signIn")}
              className={({ isActive }) =>
                cn(railItemClass, isActive ? railActive : railInactive)
              }
            >
              <LogIn {...ICON} />
            </NavLink>
          </Tooltip>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Mobile / tablet: labelled drawer                                  */
/* ---------------------------------------------------------------- */

function DrawerLink({
  to,
  icon: Icon,
  label,
  onNavigate,
  indent,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  onNavigate?: () => void;
  indent?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors",
          indent && "ml-4",
          isActive
            ? "bg-bg-tertiary text-text-primary"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
        )
      }
    >
      <Icon {...ICON} className="shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function Drawer({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const {
    user,
    profile,
    initial,
    primaryItems,
    studyItems,
    profileGroupItems,
  } = useNavModel();

  return (
    <>
      <div className="flex h-14 items-center px-4">
        <NavLink
          to="/"
          aria-label={t("sidebar.home")}
          className="flex min-w-0 items-center"
          onClick={onNavigate}
        >
          <img src="/logo.svg" alt="Pnyxy" className="h-8 w-8" />
        </NavLink>
        <QuickChatCta className="ml-3" onClick={onNavigate} />
        <button
          type="button"
          onClick={onNavigate}
          aria-label={t("common.close")}
          className="ml-auto rounded-control p-2 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <X {...ICON} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {primaryItems.map((item) => (
          <div key={item.to} className="space-y-1">
            <DrawerLink
              to={item.to}
              icon={item.icon}
              label={t(`sidebar.${item.key}`)}
              onNavigate={onNavigate}
            />
            {item.key === "chat" && studyItems.length > 0 && (
              <>
                <div className="flex items-center gap-3 px-3 pt-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  <GraduationCap size={14} strokeWidth={1.5} />
                  {t("sidebar.study")}
                </div>
                {studyItems.map((s) => (
                  <DrawerLink
                    key={s.to}
                    to={s.to}
                    icon={s.icon}
                    label={t(`sidebar.${s.key}`)}
                    onNavigate={onNavigate}
                    indent
                  />
                ))}
              </>
            )}
          </div>
        ))}
        {profileGroupItems.map((item) => (
          <DrawerLink
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={t(`sidebar.${item.key}`)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {user ? (
        <div className="flex items-center gap-1 px-2 py-2">
          <NavLink
            to="/profile"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-1.5 transition-colors",
                isActive
                  ? "bg-bg-tertiary text-text-primary"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )
            }
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-semibold text-text-primary">
              {initial}
            </span>
            <span className="truncate text-sm font-medium">
              {profile?.display_name || t("sidebar.noName")}
            </span>
          </NavLink>
          <NavLink
            to="/settings"
            onClick={onNavigate}
            aria-label={t("sidebar.settings")}
            className={({ isActive }) =>
              cn(
                "shrink-0 rounded-control p-2 transition-colors",
                isActive
                  ? "bg-bg-tertiary text-text-primary"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )
            }
          >
            <SettingsIcon size={18} strokeWidth={1.5} />
          </NavLink>
        </div>
      ) : (
        <div className="px-2 py-2">
          <DrawerLink
            to="/auth"
            icon={LogIn}
            label={t("sidebar.signIn")}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- */

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const isDesktop = useIsDesktop();

  // mobile + tablet: overlay drawer toggled by the mobileSidebarOpen flag
  if (!isDesktop) {
    return (
      <>
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
        <aside
          style={{
            top: "var(--titlebar-h)",
            height: "calc(100dvh - var(--titlebar-h))",
          }}
          className={cn(
            "fixed left-0 top-0 z-50 flex w-sidebar-expanded max-w-[85vw] flex-col rounded-r-[24px] bg-bg-secondary shadow-page",
            "transition-transform duration-300",
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Drawer onNavigate={() => setMobileSidebarOpen(false)} />
        </aside>
      </>
    );
  }

  // desktop: the 56 px icon rail on the desk. No border, no blur; the
  // page surface next to it carries the depth.
  return (
    <aside
      style={{
        top: "var(--titlebar-h)",
        height: "calc(100vh - var(--titlebar-h))",
      }}
      className="fixed left-0 top-0 z-40 flex w-sidebar-collapsed flex-col items-center gap-2 bg-bg-primary py-3.5"
    >
      <Rail />
    </aside>
  );
}

/**
 * Accent "+" that opens a fresh quick conversation from anywhere. The
 * chat page reads the `newChat` state flag (same as Ctrl+Shift+O) and
 * shows the intent chips ("learn from a YouTube video…") so the
 * student never has to set up folders first.
 */
export function QuickChatCta({
  className,
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Tooltip label={t("sidebar.quickChat")}>
      <button
        type="button"
        onClick={() => {
          onClick?.();
          navigate("/chat", { state: { newChat: Date.now() } });
        }}
        aria-label={t("sidebar.quickChat")}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition-transform hover:scale-105 active:scale-95 cursor-pointer",
          className,
        )}
      >
        <Plus size={18} strokeWidth={2} />
      </button>
    </Tooltip>
  );
}
