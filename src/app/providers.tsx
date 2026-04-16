import type { ReactNode } from "react";
import { RouterProvider } from "react-router";
import { PluginHost } from "@/lib/plugins/host-context";
import { router } from "./router";

export function AppProviders({ children }: { children?: ReactNode }) {
  return (
    <PluginHost>
      <RouterProvider router={router} />
      {children}
    </PluginHost>
  );
}
