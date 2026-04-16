import { Navigate, createBrowserRouter } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { LandingPage } from "@/features/landing/LandingPage";
import { BrowsePage } from "@/features/browse/BrowsePage";
import { BookDetailPage } from "@/features/browse/BookDetailPage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { ReaderPage } from "@/features/reader/ReaderPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { GeneralTab } from "@/features/settings/tabs/GeneralTab";
import { AppearanceTab } from "@/features/settings/tabs/AppearanceTab";
import { AiTab } from "@/features/settings/tabs/AiTab";
import { TagsTab } from "@/features/settings/tabs/TagsTab";
import { PluginsTab } from "@/features/settings/tabs/PluginsTab";
import { ShortcutsTab } from "@/features/settings/tabs/ShortcutsTab";
import { AuthPage } from "@/features/auth/AuthPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { WelcomePage } from "@/features/auth/WelcomePage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { AdminPage } from "@/features/admin/AdminPage";

export const router = createBrowserRouter([
  {
    path: "/landing",
    element: <LandingPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/auth",
    element: <AuthPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/auth/forgot-password",
    element: <ForgotPasswordPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/auth/reset-password",
    element: <ResetPasswordPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/auth/welcome",
    element: <WelcomePage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <BrowsePage /> },
      { path: "browse", element: <BrowsePage /> },
      { path: "browse/:bookId", element: <BookDetailPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "reader", element: <ReaderPage /> },
      { path: "reader/:bookId", element: <ReaderPage /> },
      {
        path: "settings",
        element: <SettingsPage />,
        children: [
          { index: true, element: <Navigate to="general" replace /> },
          { path: "general", element: <GeneralTab /> },
          { path: "appearance", element: <AppearanceTab /> },
          { path: "ai", element: <AiTab /> },
          { path: "tags", element: <TagsTab /> },
          { path: "plugins", element: <PluginsTab /> },
          { path: "shortcuts", element: <ShortcutsTab /> },
        ],
      },
      { path: "profile", element: <ProfilePage /> },
      { path: "admin", element: <AdminPage /> },
    ],
  },
]);
