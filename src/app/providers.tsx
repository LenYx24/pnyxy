import type { ReactNode } from "react";
import { RouterProvider } from "react-router";
import { router } from "./router";

export function AppProviders({ children }: { children?: ReactNode }) {
  return (
    <>
      <RouterProvider router={router} />
      {children}
    </>
  );
}
