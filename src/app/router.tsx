import { createBrowserRouter } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { LandingPage } from "@/features/landing/LandingPage";
import { BrowsePage } from "@/features/browse/BrowsePage";
import { BookDetailPage } from "@/features/browse/BookDetailPage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { ReaderPage } from "@/features/reader/ReaderPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AuthPage } from "@/features/auth/AuthPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { AdminPage } from "@/features/admin/AdminPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/auth",
    element: <AuthPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/app",
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <BrowsePage /> },
      { path: "browse", element: <BrowsePage /> },
      { path: "browse/:bookId", element: <BookDetailPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "reader", element: <ReaderPage /> },
      { path: "reader/:bookId", element: <ReaderPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "admin", element: <AdminPage /> },
    ],
  },
]);
