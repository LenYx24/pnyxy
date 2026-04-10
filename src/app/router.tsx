import { createBrowserRouter } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { LandingPage } from "@/features/landing/LandingPage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { ReaderPage } from "@/features/reader/ReaderPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/app",
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "reader", element: <ReaderPage /> },
      { path: "reader/:bookId", element: <ReaderPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
