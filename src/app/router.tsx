// This file is the route table — it exports `router`, a non-
// component object, alongside many `const PageName = lazy(...)`
// declarations the lint sees as components. react-refresh's
// "only-export-components" rule then complains about mixed exports.
// Fast refresh wouldn't be useful here anyway: HMR boundaries
// belong on the lazy-loaded page components themselves, not on
// the router config. Disable the rule file-wide.
/* eslint-disable react-refresh/only-export-components */
import { lazy } from "react";
import { Navigate, createBrowserRouter, redirect } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";

// ── Eager routes ─────────────────────────────────────────────
// These are kept in the main bundle because they're on the first-
// paint path: landing for new visitors, auth for sign-in, home for
// returning users. Together they're under 600 LOC; lazy-loading
// them would just trade bundle size for a Suspense fallback flash
// on the most common entry points.
import { LandingPage } from "@/features/landing/LandingPage";
import { HomePage } from "@/features/home/HomePage";
import { AuthPage } from "@/features/auth/AuthPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { WelcomePage } from "@/features/auth/WelcomePage";

// ── Lazy routes ──────────────────────────────────────────────
// Everything below splits into its own chunk via Vite's default
// dynamic-import code-splitting. The Suspense fallback lives on
// AppLayout's <Outlet />, so all child routes share one loading
// state. Named exports are unwrapped via `.then(m => ({default: ...}))`
// because React.lazy only accepts modules with a `default` export.

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
const WorkspacePage = lazy(() =>
  import("@/features/workspace/WorkspacePage").then((m) => ({
    default: m.WorkspacePage,
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
  import("@/features/chat/ChatPage").then((m) => ({ default: m.ChatPage })),
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
      { path: "library", element: <LibraryPage /> },
      { path: "workspace", element: <WorkspacePage /> },
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
