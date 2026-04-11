import { useState } from "react";
import { Shield } from "lucide-react";
import { cn } from "@/lib/cn";
import { AdminGuard } from "./AdminGuard";
import { DashboardTab } from "./tabs/DashboardTab";
import { ReportsTab } from "./tabs/ReportsTab";
import { CatalogModerationTab } from "./tabs/CatalogModerationTab";
import { UserManagementTab } from "./tabs/UserManagementTab";

const tabs = [
  { key: "dashboard", label: "Dashboard" },
  { key: "reports", label: "Reports" },
  { key: "catalog", label: "Catalog" },
  { key: "users", label: "Users" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");

  return (
    <AdminGuard>
      <div className="mx-auto max-w-5xl pt-14">
        <div className="mb-6 flex items-center gap-3">
          <Shield className="h-6 w-6 text-accent-purple" />
          <h1 className="text-2xl font-bold text-text-primary">Admin Panel</h1>
        </div>

        {/* Tab bar */}
        <div className="mb-6 flex gap-1 rounded-lg border border-glass-border bg-glass-bg p-1 backdrop-blur-md">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
                activeTab === key
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "dashboard" && <DashboardTab />}
        {activeTab === "reports" && <ReportsTab />}
        {activeTab === "catalog" && <CatalogModerationTab />}
        {activeTab === "users" && <UserManagementTab />}
      </div>
    </AdminGuard>
  );
}
