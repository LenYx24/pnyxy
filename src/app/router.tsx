// router config exports non-components next to lazy() consts, which trips this rule
/* eslint-disable react-refresh/only-export-components */
import type { ComponentType } from "react";
import { Navigate, createBrowserRouter, redirect } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { isTauri } from "@/lib/tauri";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";

// Eager routes: on the first-paint path, keep them in the main bundle
import { LandingPage } from "@/features/landing/LandingPage";
import { HomePage } from "@/features/home/HomePage";
import { AuthPage } from "@/features/auth/AuthPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { WelcomePage } from "@/features/auth/WelcomePage";

// Lazy routes. Suspense fallback lives on AppLayout's <Outlet />.
// .then unwraps named exports since React.lazy needs a default export.

const BrowsePage = lazy(() =>
  import("@/features/browse/BrowsePage").then((m) => ({ default: m.BrowsePage })),
);
const ImportCatalogPage = lazy(() =>
  import("@/features/catalog-import/ImportCatalogPage").then((m) => ({
    default: m.ImportCatalogPage,
  })),
);
const BookPage = lazy(() =>
  import("@/features/book/BookPage").then((m) => ({ default: m.BookPage })),
);
const OverviewTab = lazy(() =>
  import("@/features/book/tabs/OverviewTab").then((m) => ({
    default: m.OverviewTab,
  })),
);
const LearnHubTab = lazy(() =>
  import("@/features/book/tabs/LearnHubTab").then((m) => ({
    default: m.LearnHubTab,
  })),
);
const LearnMethodPlaceholder = lazy(() =>
  import("@/features/book/tabs/LearnMethodPlaceholder").then((m) => ({
    default: m.LearnMethodPlaceholder,
  })),
);
const DiscussTab = lazy(() =>
  import("@/features/book/tabs/DiscussTab").then((m) => ({
    default: m.DiscussTab,
  })),
);
const NotesTab = lazy(() =>
  import("@/features/book/tabs/NotesTab").then((m) => ({ default: m.NotesTab })),
);
const BookmarksTab = lazy(() =>
  import("@/features/book/tabs/BookmarksTab").then((m) => ({
    default: m.BookmarksTab,
  })),
);
const WhiteboardsTab = lazy(() =>
  import("@/features/book/tabs/WhiteboardsTab").then((m) => ({
    default: m.WhiteboardsTab,
  })),
);
const ResourcesTab = lazy(() =>
  import("@/features/book/tabs/ResourcesTab").then((m) => ({
    default: m.ResourcesTab,
  })),
);
const ExamsTab = lazy(() =>
  import("@/features/book/tabs/ExamsTab").then((m) => ({ default: m.ExamsTab })),
);
const LibraryPage = lazy(() =>
  import("@/features/library/LibraryPage").then((m) => ({
    default: m.LibraryPage,
  })),
);
const NotePage = lazy(() =>
  import("@/features/notes/NotePage").then((m) => ({
    default: m.NotePage,
  })),
);
const ResourceViewerPage = lazy(() =>
  import("@/features/resources/ResourceViewerPage").then((m) => ({
    default: m.ResourceViewerPage,
  })),
);
const CourseSpacePage = lazy(() =>
  import("@/features/spaces/CourseSpacePage").then((m) => ({
    default: m.CourseSpacePage,
  })),
);
const PromptGalleryPage = lazy(() =>
  import("@/features/spaces/PromptGalleryPage").then((m) => ({
    default: m.PromptGalleryPage,
  })),
);
const ReaderPage = lazy(() =>
  import("@/features/reader/ReaderPage").then((m) => ({
    default: m.ReaderPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);
const GeneralTab = lazy(() =>
  import("@/features/settings/tabs/GeneralTab").then((m) => ({
    default: m.GeneralTab,
  })),
);
const AppearanceTab = lazy(() =>
  import("@/features/settings/tabs/AppearanceTab").then((m) => ({
    default: m.AppearanceTab,
  })),
);
const AiTab = lazy(() =>
  import("@/features/settings/tabs/AiTab").then((m) => ({ default: m.AiTab })),
);
const OrganizationsTab = lazy(() =>
  import("@/features/settings/tabs/OrganizationsTab").then((m) => ({
    default: m.OrganizationsTab,
  })),
);
const TagsTab = lazy(() =>
  import("@/features/settings/tabs/TagsTab").then((m) => ({ default: m.TagsTab })),
);
const PluginsTab = lazy(() =>
  import("@/features/settings/tabs/PluginsTab").then((m) => ({
    default: m.PluginsTab,
  })),
);
const ShortcutsTab = lazy(() =>
  import("@/features/settings/tabs/ShortcutsTab").then((m) => ({
    default: m.ShortcutsTab,
  })),
);
const FeedbackTab = lazy(() =>
  import("@/features/settings/tabs/FeedbackTab").then((m) => ({
    default: m.FeedbackTab,
  })),
);
const AboutTab = lazy(() =>
  import("@/features/settings/tabs/AboutTab").then((m) => ({
    default: m.AboutTab,
  })),
);
const QuizzesPage = lazy(() =>
  import("@/features/quizzes/QuizzesPage").then((m) => ({
    default: m.QuizzesPage,
  })),
);
const WhiteboardPage = lazy(() =>
  import("@/features/whiteboard/WhiteboardPage").then((m) => ({
    default: m.WhiteboardPage,
  })),
);
const VocabularyPage = lazy(() =>
  import("@/features/vocabulary/VocabularyPage").then((m) => ({
    default: m.VocabularyPage,
  })),
);
const SpacesPage = lazy(() =>
  import("@/features/spaces/SpacesPage").then((m) => ({
    default: m.SpacesPage,
  })),
);
const QuizEditorPage = lazy(() =>
  import("@/features/quizzes/QuizEditorPage").then((m) => ({
    default: m.QuizEditorPage,
  })),
);
const QuizAttemptReviewPage = lazy(() =>
  import("@/features/quizzes/QuizAttemptReviewPage").then((m) => ({
    default: m.QuizAttemptReviewPage,
  })),
);
const QuizReviewPage = lazy(() =>
  import("@/features/quizzes/QuizReviewPage").then((m) => ({
    default: m.QuizReviewPage,
  })),
);
const QuizDetailPage = lazy(() =>
  import("@/features/quizzes/QuizDetailPage").then((m) => ({
    default: m.QuizDetailPage,
  })),
);
const QuizTakePage = lazy(() =>
  import("@/features/quizzes/QuizTakePage").then((m) => ({
    default: m.QuizTakePage,
  })),
);
const ProfilePage = lazy(() =>
  import("@/features/profile/ProfilePage").then((m) => ({
    default: m.ProfilePage,
  })),
);
const AdminPage = lazy(() =>
  import("@/features/admin/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const StreaksPage = lazy(() =>
  import("@/features/streaks/StreaksPage").then((m) => ({
    default: m.StreaksPage,
  })),
);
const LeaderboardsPage = lazy(() =>
  import("@/features/streaks/LeaderboardsPage").then((m) => ({
    default: m.LeaderboardsPage,
  })),
);
const PlanDetailPage = lazy(() =>
  import("@/features/streaks/PlanDetailPage").then((m) => ({
    default: m.PlanDetailPage,
  })),
);
const RoadmapsPage = lazy(() =>
  import("@/features/roadmaps/RoadmapsPage").then((m) => ({
    default: m.RoadmapsPage,
  })),
);
const RoadmapDetailPage = lazy(() =>
  import("@/features/roadmaps/RoadmapDetailPage").then((m) => ({
    default: m.RoadmapDetailPage,
  })),
);
const RoadmapEditorPage = lazy(() =>
  import("@/features/roadmaps/RoadmapEditorPage").then((m) => ({
    default: m.RoadmapEditorPage,
  })),
);
const ChatPage = lazy(() =>
  import("@/features/chat/ChatPage").then((m) => ({
    // ChatPage takes optional book-scope props; the /chat route uses it bare
    default: m.ChatPage as ComponentType<unknown>,
  })),
);
const BookChatPage = lazy(() =>
  import("@/features/chat/BookChatPage").then((m) => ({
    default: m.BookChatPage,
  })),
);
const ForumPage = lazy(() =>
  import("@/features/forum/ForumPage").then((m) => ({ default: m.ForumPage })),
);
const ForumExplorePage = lazy(() =>
  import("@/features/forum/ForumExplorePage").then((m) => ({
    default: m.ForumExplorePage,
  })),
);
const CommunityPage = lazy(() =>
  import("@/features/forum/CommunityPage").then((m) => ({
    default: m.CommunityPage,
  })),
);
const PostPage = lazy(() =>
  import("@/features/forum/PostPage").then((m) => ({ default: m.PostPage })),
);
const PostComposer = lazy(() =>
  import("@/features/forum/PostComposer").then((m) => ({
    default: m.PostComposer,
  })),
);
const AboutPage = lazy(() =>
  import("@/features/static/AboutPage").then((m) => ({ default: m.AboutPage })),
);
const PrivacyPage = lazy(() =>
  import("@/features/static/PrivacyPage").then((m) => ({
    default: m.PrivacyPage,
  })),
);
const TermsPage = lazy(() =>
  import("@/features/static/TermsPage").then((m) => ({ default: m.TermsPage })),
);
const HelpPage = lazy(() =>
  import("@/features/static/HelpPage").then((m) => ({ default: m.HelpPage })),
);
const TutorialPage = lazy(() =>
  import("@/features/static/TutorialPage").then((m) => ({
    default: m.TutorialPage,
  })),
);
const DownloadPage = lazy(() =>
  import("@/features/static/DownloadPage").then((m) => ({
    default: m.DownloadPage,
  })),
);

export const router = createBrowserRouter([
  {
    // Public, pre-auth pages. PublicLayout forces the static dark
    // marketing palette so none of them inherit the user's app theme.
    element: <PublicLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: "/landing", element: <LandingPage /> },
      { path: "/auth", element: <AuthPage /> },
      { path: "/auth/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/auth/reset-password", element: <ResetPasswordPage /> },
      { path: "/auth/welcome", element: <WelcomePage /> },
    ],
  },
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <HomePage />,
        // first-time visitors get redirected to /landing; flag is set on LandingPage mount
        loader: () => {
          if (typeof window === "undefined") return null;
          // Desktop (native app or a wide viewport) goes straight into the
          // app; the landing stays a mobile/marketing entry. /landing is
          // still reachable directly by URL.
          try {
            if (isTauri || window.matchMedia("(min-width: 768px)").matches) {
              return null;
            }
          } catch {
            return null;
          }
          try {
            if (localStorage.getItem("pnyxy:has-seen-landing")) return null;
          } catch {
            return null;
          }
          return redirect("/landing");
        },
      },
      { path: "browse", element: <BrowsePage /> },
      { path: "catalog", element: <BrowsePage /> },
      { path: "catalog/import", element: <ImportCatalogPage /> },
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
          { path: "bookmarks", element: <BookmarksTab /> },
          { path: "whiteboards", element: <WhiteboardsTab /> },
          { path: "resources", element: <ResourcesTab /> },
          { path: "exams", element: <ExamsTab /> },
        ],
      },
      // full-screen book-scoped chat (separate from the book layout above)
      { path: "books/:bookId/chat", element: <BookChatPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "notes/:noteId", element: <NotePage /> },
      { path: "resources/:resourceId", element: <ResourceViewerPage /> },
      { path: "workspace", element: <Navigate to="/library" replace /> },
      { path: "streaks", element: <StreaksPage /> },
      { path: "plans/new", element: <PlanDetailPage /> },
      { path: "plans/:planId", element: <PlanDetailPage /> },
      { path: "roadmaps", element: <RoadmapsPage /> },
      { path: "roadmaps/:roadmapId", element: <RoadmapDetailPage /> },
      { path: "roadmaps/:roadmapId/edit", element: <RoadmapEditorPage /> },
      { path: "forum", element: <ForumPage /> },
      { path: "forum/explore", element: <ForumExplorePage /> },
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
          { path: "plan", element: <Navigate to="/profile" replace /> },
          { path: "appearance", element: <AppearanceTab /> },
          { path: "ai", element: <AiTab /> },
          { path: "organizations", element: <OrganizationsTab /> },
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
      { path: "spaces", element: <SpacesPage /> },
      { path: "spaces/:spaceId", element: <CourseSpacePage /> },
      { path: "spaces/:spaceId/gallery", element: <PromptGalleryPage /> },
      { path: "gallery", element: <PromptGalleryPage /> },
      { path: "whiteboards/:whiteboardId", element: <WhiteboardPage /> },
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
      { path: "tutorial", element: <TutorialPage /> },
      { path: "download", element: <DownloadPage /> },
      { path: "leaderboards", element: <LeaderboardsPage /> },
      { path: "chat", element: <ChatPage /> },
    ],
  },
]);
