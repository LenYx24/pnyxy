import type { ReactNode } from "react";
import { RouterProvider } from "react-router";
import { PluginHost } from "@/lib/plugins/host-context";
import { CustomTitleBar } from "@/components/layout/CustomTitleBar";
import { router } from "./router";

export function AppProviders({ children }: { children?: ReactNode }) {
  return (
    <PluginHost>
      {/* native-only window title bar (renders nothing in the browser) */}
      <CustomTitleBar />
      <RouterProvider router={router} />
      {children}
    </PluginHost>
  );
}
