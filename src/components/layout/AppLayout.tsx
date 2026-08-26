import { Suspense, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
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
import { OfflineBanner } from "./OfflineBanner";
import { DocumentLoadingOverlay } from "./DocumentLoadingOverlay";
import { RouteLoadingBar } from "./RouteLoadingBar";
import { startTelemetry } from "@/lib/telemetry";
import { ContextMenu } from "@/components/ui";
import { ShortcutsSheet } from "@/components/ui/ShortcutsSheet";
import { useShortcutsSheet } from "@/components/ui/shortcuts-sheet-store";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { BannedScreen } from "@/features/admin/BannedScreen";
import { StreakCelebrationModal } from "@/features/library/StreakCelebrationModal";
import { FeedbackPrompt } from "@/features/feedback/FeedbackPrompt";
import { TtsMiniPlayer } from "@/components/tts/TtsMiniPlayer";
import { OnboardingTour } from "@/features/onboarding/OnboardingTour";

const STATIC_PAGE_PATHS = [
  "/about",
  "/privacy",
  "/terms",
  "/help",
  "/tutorial",
];

export function AppLayout() {
  const { sidebarCollapsed, setSidebarCollapsed } = useUIStore();
  const { isBanned, banInfo } = useAuthStore();
  const telemetryUser = useAuthStore((s) => s.user);
  useEffect(() => {
    if (telemetryUser) startTelemetry();
  }, [telemetryUser]);
  const focusActive = useFocusStore((s) => s.active);
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const navigate = useNavigate();

  const isReaderRoute = location.pathname.startsWith("/reader");
  const isChatRoute = location.pathname.startsWith("/chat");
  // flush layout: sticky left rail with its own border needs to reach the viewport edge, outer padding strands the border
  const isBookRoute = location.pathname.startsWith("/books");
  const useFlushContent = isReaderRoute || isChatRoute || isBookRoute;
  // library owns a sticky bottom bar (count + storage) that pins via
  // mt-auto; make its wrapper a flex column so the page can flex-grow.
  const isLibraryRoute = location.pathname === "/library";

  // collapse sidebar on every reader entry, reader toolbar has its own hamburger to bring it back
  useEffect(() => {
    if (isReaderRoute) setSidebarCollapsed(true);
  }, [isReaderRoute, setSidebarCollapsed]);

  // footer only on the informational / legal pages
  const showFooter = STATIC_PAGE_PATHS.some((p) =>
    location.pathname.startsWith(p),
  );

  // Cmd/Ctrl+, opens settings (handler treats ctrl as cmd-or-ctrl)
  useKeyboardShortcut({
    id: "app:open-settings",
    key: ",",
    ctrl: true,
    description: "Open settings",
    handler: () => navigate("/settings"),
  });
  // Ctrl+Shift+O: new chat from anywhere (Gemini's default). ChatPage
  // reads the `newChat` state flag and starts a fresh conversation.
  useKeyboardShortcut({
    id: "app:new-chat",
    key: "o",
    ctrl: true,
    shift: true,
    description: "New chat",
    handler: () => navigate("/chat", { state: { newChat: Date.now() } }),
  });

  // Ctrl+/ (and a bare "?" outside of text fields) toggles the shortcuts
  // cheat sheet. The registry already skips input/textarea targets; the
  // "?" variant additionally stays out of contenteditable editors.
  const toggleShortcutsSheet = useShortcutsSheet((s) => s.toggle);
  useKeyboardShortcut({
    id: "app:shortcuts-sheet",
    key: "/",
    ctrl: true,
    description: "Keyboard shortcuts",
    handler: toggleShortcutsSheet,
  });
  useKeyboardShortcut({
    id: "app:shortcuts-sheet-help",
    key: "?",
    shift: true,
    description: "Keyboard shortcuts",
    preventDefault: false,
    handler: () => {
      const el = document.activeElement as HTMLElement | null;
      if (el?.isContentEditable) return;
      toggleShortcutsSheet();
    },
  });

  // PDFs handed off by the OS via the PWA File Handlers API, route them into the reader
  const { fileInputRef, triggerFilePicker, handleFileSelect, openFile } =
    useOpenDocument();
  // Ctrl+O: open a book from disk anywhere. The library and the reader
  // register their own (scoped ids win over this global one).
  useKeyboardShortcut({
    id: "app:open-book",
    key: "o",
    ctrl: true,
    description: "Open a file from disk",
    handler: triggerFilePicker,
  });

  // during a focus session only reader shortcuts pass through
  useEffect(() => {
    if (focusActive) {
      setShortcutGate((id) => id.startsWith("reader:"));
      return () => setShortcutGate(null);
    }
    return undefined;
  }, [focusActive]);
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

  // on the reader, fully hide the sidebar when collapsed instead of leaving the
  // narrow rail. Desktop only: on mobile the <Sidebar/> renders just an
  // off-screen drawer (no rail), and it must stay mounted so the reader
  // toolbar's hamburger has something to slide open.
  const hideSidebarForReader = isReaderRoute && sidebarCollapsed && isDesktop;
  const showSidebar = !focusActive && !hideSidebarForReader;
  const showBottomNav = !focusActive && !isReaderRoute && !isChatRoute;
  // hidden on reader (ReaderToolbar) and chat (its own header is the single top bar)
  const showMobileTopBar =
    !isReaderRoute && !isChatRoute && !focusActive && !showFooter;
  const sidebarMargin = showSidebar && isDesktop;
  // chat and reader draw their own desk + sheet layout (conversation
  // panel on the desk, the thread as the sheet; the reader is all desk),
  // so the generic page surface would double-wrap them
  const pageSurface = isDesktop && !focusActive && !isChatRoute && !isReaderRoute;

  return (
    // flex row: a spacer the width of the fixed rail + the page column.
    // `min-w-0 flex-1` on <main> makes the sheet exactly viewport minus
    // rail (a margin-based offset plus any w-full child would overflow
    // to the right and clip the sheet's edge + shadow); overflow-x-clip
    // on the root guards against a wide child adding a horizontal
    // scrollbar.
    <div className="flex min-h-dvh w-full overflow-x-clip bg-bg-primary">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.html,.docx,.pptx,.xlsx,.mobi,.azw3,.fb2,.cbz,.cbr,.djvu"
        onChange={handleFileSelect}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      {/* renders nothing when online */}
      <OfflineBanner />
      {/* slim top bar while a lazy route chunk loads (renders nothing when idle) */}
      <RouteLoadingBar />
      {showSidebar && <Sidebar />}
      {showMobileTopBar && <MobileTopBar />}
      {sidebarMargin && (
        <div aria-hidden className="w-sidebar-collapsed shrink-0" />
      )}
      {/* flex-col + min-h-screen lets the flex-1 wrapper pin the footer to the bottom on short pages */}
      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          // lock reader/chat to 100dvh + overflow-hidden: min-h-screen (100vh) lets mobile URL-bar chrome scroll the body and expose a black strip below the composer
          isReaderRoute || isChatRoute
            ? "h-[100dvh] overflow-hidden"
            : "min-h-dvh",
          // push content below the fixed mobile top bar
          showMobileTopBar && "pt-12 md:pt-0",
        )}
        // offset below the custom title bar (--titlebar-h is 0 in the browser)
        style={{
          marginTop: "var(--titlebar-h)",
          ...(isReaderRoute || isChatRoute
            ? { height: "calc(100dvh - var(--titlebar-h))" }
            : { minHeight: "calc(100dvh - var(--titlebar-h))" }),
        }}
      >
        {/* "page" surface (UI v2): on desktop the content sits on a
            surface-1 sheet lifted off the desk by the one shadow token,
            rounded 24 px on the edge facing the rail, 10 px breathing
            room above and below. Mobile stays flush and square. */}
        <div
          className={cn(
            "flex-1",
            pageSurface &&
              "my-2.5 mr-2.5 min-h-0 overflow-clip rounded-page bg-bg-secondary shadow-page",
            // chat/reader: no sheet, but keep the flex/min-h-0/clip so the
            // page itself never scrolls (their inner panes own scrolling)
            !pageSurface && isDesktop && (isChatRoute || isReaderRoute) &&
              "flex min-h-0 flex-col overflow-clip",
            useFlushContent ? "p-0" : "p-4 md:p-6",
            // library-only: flex column so LibraryPage (flex-1) grows to
            // fill and its bottom bar pins via mt-auto on short grids.
            isLibraryRoute && "flex flex-col",
          )}
        >
          {/* fallback for lazy-loaded route chunks */}
          <Suspense
            fallback={
              <div className="flex h-full min-h-[40vh] items-center justify-center">
                <Loader2
                  size={24}
                  className="animate-spin text-accent/70"
                  aria-label="Loading"
                />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
        {showFooter && <Footer />}
        {/* spacer so content doesn't sit under the bottom nav on mobile */}
        {showBottomNav && !showFooter && !isReaderRoute && (
          <div aria-hidden className="h-16 md:h-0" />
        )}
      </main>
      {showBottomNav && <BottomNav />}
      <StreakCelebrationModal />
      <OnboardingTour />
      <FeedbackPrompt />
      <ContextMenu />
      <CommandPalette />
      <ShortcutsSheet />
      <TtsMiniPlayer />
      <DocumentLoadingOverlay />
    </div>
  );
}
