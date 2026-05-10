import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useFocusStore } from "@/stores/focus-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useOpenDocument } from "@/hooks/use-open-document";
import { setShortcutGate } from "@/lib/keyboard-shortcuts";
import {
  setLaunchedFilesListener,
  clearLaunchedFilesListener,
} from "@/lib/launched-files";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { MobileTopBar } from "./MobileTopBar";
import { Footer } from "./Footer";
import { ContextMenu } from "@/components/ui";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { BannedScreen } from "@/features/admin/BannedScreen";
import { StreakCelebrationModal } from "@/features/library/StreakCelebrationModal";

const STATIC_PAGE_PATHS = ["/about", "/privacy", "/terms", "/help", "/tutorial"];

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar, setSidebarCollapsed } = useUIStore();
  const { isBanned, banInfo } = useAuthStore();
  const focusActive = useFocusStore((s) => s.active);
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const navigate = useNavigate();

  // Hide chrome (sidebar, topbar, bottom nav) when in reader OR when a
  // focus session is active (user explicitly asked for an
  // uninterrupted reading surface).
  const isReaderRoute = location.pathname.startsWith("/reader");
  // Chat wants a flush, full-width layout too — the conversation
  // sidebar should sit right against the global app sidebar with no
  // gap, and the thread should use the full viewport. Same p-0
  // treatment as the reader.
  const isChatRoute = location.pathname.startsWith("/chat");
  // BookPage's left rail follows the same pattern: a sticky sidebar
  // with its own right border. Adding outer p-4/p-6 around it gave
  // the rail a top + left margin and made the right border look like
  // a stranded line. Flush mode lets the rail reach the app's
  // sidebar / viewport edges. The BookPage's main pane has its own
  // internal p-4 sm:p-6 md:p-8 so content there stays comfortable.
  const isBookRoute = location.pathname.startsWith("/books");
  const useFlushContent = isReaderRoute || isChatRoute || isBookRoute;

  // Collapse the global sidebar by default when the user enters the
  // reader. Reading wants every horizontal pixel; the reader's own
  // toolbar still has a hamburger that brings the sidebar back when
  // the user wants to navigate away. Triggers on every entry into
  // the reader route — if the user manually expanded mid-session
  // and then exited and re-entered a book, we collapse again,
  // because that's the explicit user request ("by default collapse"
  // on every book open).
  useEffect(() => {
    if (isReaderRoute) setSidebarCollapsed(true);
  }, [isReaderRoute, setSidebarCollapsed]);

  // Footer is only rendered on the informational / legal pages. The
  // main app surfaces (library, browse, reader, settings, profile,
  // streaks, admin) use the sidebar for navigation and don't need a
  // site-wide footer taking up viewport space.
  const showFooter = STATIC_PAGE_PATHS.some((p) =>
    location.pathname.startsWith(p),
  );

  useKeyboardShortcut({
    id: "app:toggle-sidebar",
    key: "b",
    ctrl: true,
    description: "Toggle sidebar",
    handler: toggleSidebar,
  });
  // Cmd/Ctrl+, opens Settings — the universal "Preferences" hotkey
  // (VSCode, Obsidian, macOS, Discord). The shortcut handler treats
  // ctrl as cmd-or-ctrl, so this works on both platforms.
  useKeyboardShortcut({
    id: "app:open-settings",
    key: ",",
    ctrl: true,
    description: "Open settings",
    handler: () => navigate("/settings"),
  });

  // While a focus session is active, only reading-related shortcuts and
  // the sidebar toggle pass through; navigation/library/forum hotkeys
  // are silently ignored to discourage accidental tab-switching.
  useEffect(() => {
    if (focusActive) {
      setShortcutGate(
        (id) => id.startsWith("reader:") || id === "app:toggle-sidebar",
      );
      return () => setShortcutGate(null);
    }
    return undefined;
  }, [focusActive]);

  // Receive PDFs handed off by the OS via the PWA File Handlers API
  // ("Open with Pnyxy") and route them straight into the reader.
  const { openFile } = useOpenDocument();
  useEffect(() => {
    setLaunchedFilesListener((files) => {
      const first = files[0];
      if (first) void openFile(first);
    });
    return () => clearLaunchedFilesListener();
  }, [openFile]);

  if (isBanned && banInfo) {
    return <BannedScreen />;
  }

  // Sidebar (desktop/tablet) is shown on most routes, but on the
  // reader we *fully* hide it when collapsed instead of leaving the
  // narrow rail visible. Reading benefits from every horizontal pixel,
  // and the reader's own toolbar grows a hamburger that expands the
  // sidebar back when the user wants to navigate away.
  const hideSidebarForReader = isReaderRoute && sidebarCollapsed;
  const showSidebar = !focusActive && !hideSidebarForReader;
  // Bottom nav now stays visible on the reader too — the user
  // explicitly asked for persistent app navigation while reading.
  // The reader's own MobileReaderBottomBar slides above the global
  // nav (see its `bottom` offset) so the two stack without overlap.
  const showBottomNav = !focusActive;
  // Mobile-only top bar carries the brand + the avatar/profile menu
  // (Profile, Settings, Sign-out). Hidden on the reader since
  // ReaderToolbar already occupies that space, and during a focus
  // session for an uninterrupted reading surface.
  const showMobileTopBar = !isReaderRoute && !focusActive && !showFooter;
  const sidebarMargin = showSidebar && isDesktop;

  return (
    <div className="min-h-screen bg-bg-primary">
      {showSidebar && <Sidebar />}
      {showMobileTopBar && <MobileTopBar />}
      {/* main is flex-col + min-h-screen so a flex-1 content wrapper
          stretches to fill the viewport on short pages — that's what
          pins the footer (and the bottom-nav spacer) to the visual
          bottom on About / Privacy / Terms / Help. */}
      <main
        className={cn(
          "flex min-h-screen flex-col transition-[margin] duration-200 ease-out",
          sidebarMargin && (sidebarCollapsed ? "ml-sidebar-collapsed" : "ml-sidebar-expanded"),
          // Push content below the mobile top bar so it doesn't sit
          // behind the fixed header. Reader is excluded above so it
          // gets to use the full vertical space.
          showMobileTopBar && "pt-12 md:pt-0",
        )}
      >
        <div
          className={cn(
            "flex-1",
            useFlushContent ? "p-0" : "p-4 md:p-6",
          )}
        >
          <Outlet />
        </div>
        {showFooter && <Footer />}
        {/* Spacer so app routes' content + bottom-nav don't overlap
            on mobile. Footer routes already render their own block
            and we accept it sitting partly behind the nav there.
            The reader has its own internal padding handling, so
            skip the spacer there. */}
        {showBottomNav && !showFooter && !isReaderRoute && (
          <div aria-hidden className="h-16 md:h-0" />
        )}
      </main>
      {showBottomNav && <BottomNav />}
      <StreakCelebrationModal />
      <ContextMenu />
      <CommandPalette />
    </div>
  );
}
