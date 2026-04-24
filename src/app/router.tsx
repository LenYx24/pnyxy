import { Navigate, createBrowserRouter, redirect } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { LandingPage } from "@/features/landing/LandingPage";
import { HomePage } from "@/features/home/HomePage";
import { BrowsePage } from "@/features/browse/BrowsePage";
import { BookPage } from "@/features/book/BookPage";
import { OverviewTab } from "@/features/book/tabs/OverviewTab";
import { LearnHubTab } from "@/features/book/tabs/LearnHubTab";
import { LearnMethodPlaceholder } from "@/features/book/tabs/LearnMethodPlaceholder";
import { DiscussTab } from "@/features/book/tabs/DiscussTab";
import { NotesTab } from "@/features/book/tabs/NotesTab";
import { ResourcesTab } from "@/features/book/tabs/ResourcesTab";
import { LibraryPage } from "@/features/library/LibraryPage";
import { ReaderPage } from "@/features/reader/ReaderPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { GeneralTab } from "@/features/settings/tabs/GeneralTab";
import { AppearanceTab } from "@/features/settings/tabs/AppearanceTab";
import { AiTab } from "@/features/settings/tabs/AiTab";
import { TagsTab } from "@/features/settings/tabs/TagsTab";
import { PluginsTab } from "@/features/settings/tabs/PluginsTab";
import { ShortcutsTab } from "@/features/settings/tabs/ShortcutsTab";
import { FeedbackTab } from "@/features/settings/tabs/FeedbackTab";
import { AboutTab } from "@/features/settings/tabs/AboutTab";
import { QuizzesPage } from "@/features/quizzes/QuizzesPage";
import { VocabularyPage } from "@/features/vocabulary/VocabularyPage";
import { QuizEditorPage } from "@/features/quizzes/QuizEditorPage";
import { QuizAttemptReviewPage } from "@/features/quizzes/QuizAttemptReviewPage";
import { QuizReviewPage } from "@/features/quizzes/QuizReviewPage";
import { QuizDetailPage } from "@/features/quizzes/QuizDetailPage";
import { QuizTakePage } from "@/features/quizzes/QuizTakePage";
import { AuthPage } from "@/features/auth/AuthPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { WelcomePage } from "@/features/auth/WelcomePage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { AdminPage } from "@/features/admin/AdminPage";
import { StreaksPage } from "@/features/streaks/StreaksPage";
import { LeaderboardsPage } from "@/features/streaks/LeaderboardsPage";
import { ChatPage } from "@/features/chat/ChatPage";
import { ForumPage } from "@/features/forum/ForumPage";
import { CommunityPage } from "@/features/forum/CommunityPage";
import { PostPage } from "@/features/forum/PostPage";
import { PostComposer } from "@/features/forum/PostComposer";
import { AboutPage } from "@/features/static/AboutPage";
import { PrivacyPage } from "@/features/static/PrivacyPage";
import { TermsPage } from "@/features/static/TermsPage";
import { HelpPage } from "@/features/static/HelpPage";
import { DownloadPage } from "@/features/static/DownloadPage";

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
      {
        index: true,
        element: <HomePage />,
        // First-time visitors land on /landing so they see the pitch
        // before the catalog. The flag is set on the LandingPage
        // mount, so subsequent visits go straight to browse — daily
        // anonymous users aren't re-pitched every visit. Only the
        // literal index path is gated; /browse/:id and other deep
        // links stay reachable for shared URLs.
        loader: () => {
          if (typeof window === "undefined") return null;
          try {
            if (localStorage.getItem("pnyxy:has-seen-landing")) return null;
          } catch {
            return null;
          }
          return redirect("/landing");
        },
      },
      { path: "browse", element: <BrowsePage /> },
      {
        path: "browse/:bookId",
        loader: ({ params }) => redirect(`/books/${params.bookId}`),
      },
      {
        path: "books/:bookId",
        element: <BookPage />,
        children: [
          { index: true, element: <OverviewTab /> },
          { path: "learn", element: <LearnHubTab /> },
          { path: "learn/:methodSlug", element: <LearnMethodPlaceholder /> },
          { path: "discuss", element: <DiscussTab /> },
          { path: "notes", element: <NotesTab /> },
          { path: "resources", element: <ResourcesTab /> },
        ],
      },
      { path: "library", element: <LibraryPage /> },
      { path: "streaks", element: <StreaksPage /> },
      { path: "forum", element: <ForumPage /> },
      { path: "forum/c/:slug", element: <CommunityPage /> },
      { path: "forum/c/:slug/p/:postId", element: <PostPage /> },
      { path: "forum/c/:slug/new", element: <PostComposer /> },
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
          { path: "feedback", element: <FeedbackTab /> },
          { path: "about", element: <AboutTab /> },
        ],
      },
      { path: "profile", element: <ProfilePage /> },
      { path: "admin", element: <AdminPage /> },
      { path: "vocabulary", element: <VocabularyPage /> },
      { path: "quizzes", element: <QuizzesPage /> },
      { path: "quizzes/review", element: <QuizReviewPage /> },
      { path: "quizzes/new", element: <QuizEditorPage /> },
      { path: "quizzes/:quizId", element: <QuizDetailPage /> },
      { path: "quizzes/:quizId/edit", element: <QuizEditorPage /> },
      { path: "quizzes/:quizId/take", element: <QuizTakePage /> },
      {
        path: "quizzes/:quizId/attempts/:attemptId",
        element: <QuizAttemptReviewPage />,
      },
      { path: "about", element: <AboutPage /> },
      { path: "privacy", element: <PrivacyPage /> },
      { path: "terms", element: <TermsPage /> },
      { path: "help", element: <HelpPage /> },
      { path: "download", element: <DownloadPage /> },
      { path: "leaderboards", element: <LeaderboardsPage /> },
      { path: "chat", element: <ChatPage /> },
    ],
  },
]);
