import { Outlet } from "react-router";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  useKeyboardShortcut({
    id: "app:toggle-sidebar",
    key: "b",
    ctrl: true,
    description: "Toggle sidebar",
    handler: toggleSidebar,
  });

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
