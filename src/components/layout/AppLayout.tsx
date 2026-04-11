import { Outlet } from "react-router";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BannedScreen } from "@/features/admin/BannedScreen";

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { isBanned, banInfo } = useAuthStore();

  useKeyboardShortcut({
    id: "app:toggle-sidebar",
    key: "b",
    ctrl: true,
    description: "Toggle sidebar",
    handler: toggleSidebar,
  });

  if (isBanned && banInfo) {
    return <BannedScreen />;
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <Sidebar />
      <TopBar />
      <main
        className={cn(
          "transition-all duration-300 p-6",
          sidebarCollapsed ? "ml-sidebar-collapsed" : "ml-sidebar-expanded",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
