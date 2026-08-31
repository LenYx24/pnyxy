// router config exports non-components next to lazy() consts, which trips this rule
/* eslint-disable react-refresh/only-export-components */
import type { ComponentType } from "react";
import { Navigate, createBrowserRouter, redirect, useParams } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { isTauri } from "@/lib/tauri";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { FeatureGate } from "@/components/FeatureGate";
import { setAppRouter } from "@/lib/app-router-ref";

/** /browse/:bookId -> /books/:bookId (element instead of a loader so the
 *  catalog FeatureGate can wrap it). */
function BrowseBookRedirect() {
  const { bookId } = useParams();
  return <Navigate to={`/books/${bookId}`} replace />;
}

// Eager routes: on the first-paint path, keep them in the main bundle
import { LandingPage } from "@/features/landing/LandingPage";
import { HomePage } from "@/features/home/HomePage";
import { AuthPage } from "@/features/auth/AuthPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { WelcomePage } from "@/features/auth/WelcomePage";
import { ExtensionPanelPage } from "@/features/extension/ExtensionPanelPage";
import { OpenUrlPage } from "@/features/resources/OpenUrlPage";

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
const ReadingTab = lazy(() =>
  import("@/features/book/tabs/ReadingTab").then((m) => ({
    default: m.ReadingTab,
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
const AdminUserDetailPage = lazy(() =>
  import("@/features/admin/AdminUserDetailPage").then((m) => ({
    default: m.AdminUserDetailPage,
  })),
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
      // browser extension side panel (iframe); no app chrome
      { path: "/ext", element: <ExtensionPanelPage /> },
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
      { path: "browse", element: <FeatureGate feature="catalog"><BrowsePage /></FeatureGate> },
      { path: "catalog", element: <FeatureGate feature="catalog"><BrowsePage /></FeatureGate> },
      { path: "catalog/import", element: <FeatureGate feature="catalog"><ImportCatalogPage /></FeatureGate> },
      {
        path: "browse/:bookId",
        element: <FeatureGate feature="catalog"><BrowseBookRedirect /></FeatureGate>,
      },
      {
        path: "books/:bookId",
        element: <BookPage />,
        children: [
          { index: true, element: <OverviewTab /> },
          { path: "reading", element: <ReadingTab /> },
          { path: "learn", element: <FeatureGate feature="learnHub"><LearnHubTab /></FeatureGate> },
          { path: "learn/:methodSlug", element: <FeatureGate feature="learnHub"><LearnMethodPlaceholder /></FeatureGate> },
          { path: "discuss", element: <FeatureGate feature="forum"><DiscussTab /></FeatureGate> },
          { path: "notes", element: <FeatureGate feature="notes"><NotesTab /></FeatureGate> },
          { path: "bookmarks", element: <FeatureGate feature="bookmarks"><BookmarksTab /></FeatureGate> },
          { path: "whiteboards", element: <FeatureGate feature="whiteboard"><WhiteboardsTab /></FeatureGate> },
          { path: "resources", element: <ResourcesTab /> },
          { path: "exams", element: <FeatureGate feature="quizzes"><ExamsTab /></FeatureGate> },
        ],
      },
      // full-screen book-scoped chat (separate from the book layout above)
      { path: "books/:bookId/chat", element: <BookChatPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "notes/:noteId", element: <FeatureGate feature="notes"><NotePage /></FeatureGate> },
      { path: "resources/:resourceId", element: <ResourceViewerPage /> },
      // extension hand-off: save a link and land on its viewer
      { path: "open", element: <OpenUrlPage /> },
      { path: "workspace", element: <Navigate to="/library" replace /> },
      { path: "streaks", element: <StreaksPage /> },
      { path: "plans/new", element: <FeatureGate feature="readingPlans"><PlanDetailPage /></FeatureGate> },
      { path: "plans/:planId", element: <FeatureGate feature="readingPlans"><PlanDetailPage /></FeatureGate> },
      { path: "roadmaps", element: <FeatureGate feature="roadmaps"><RoadmapsPage /></FeatureGate> },
      { path: "roadmaps/:roadmapId", element: <FeatureGate feature="roadmaps"><RoadmapDetailPage /></FeatureGate> },
      { path: "roadmaps/:roadmapId/edit", element: <FeatureGate feature="roadmaps"><RoadmapEditorPage /></FeatureGate> },
      { path: "forum", element: <FeatureGate feature="forum"><ForumPage /></FeatureGate> },
      { path: "forum/explore", element: <FeatureGate feature="forum"><ForumExplorePage /></FeatureGate> },
      { path: "forum/c/:slug", element: <FeatureGate feature="forum"><CommunityPage /></FeatureGate> },
      { path: "forum/c/:slug/p/:postId", element: <FeatureGate feature="forum"><PostPage /></FeatureGate> },
      { path: "forum/c/:slug/new", element: <FeatureGate feature="forum"><PostComposer /></FeatureGate> },
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
          { path: "plugins", element: <FeatureGate feature="plugins"><PluginsTab /></FeatureGate> },
          { path: "shortcuts", element: <ShortcutsTab /> },
          { path: "feedback", element: <FeedbackTab /> },
          { path: "about", element: <AboutTab /> },
        ],
      },
      { path: "profile", element: <ProfilePage /> },
      { path: "admin", element: <AdminPage /> },
      { path: "admin/users/:userId", element: <AdminUserDetailPage /> },
      { path: "vocabulary", element: <FeatureGate feature="vocabulary"><VocabularyPage /></FeatureGate> },
      { path: "spaces", element: <FeatureGate feature="spaces"><SpacesPage /></FeatureGate> },
      { path: "spaces/:spaceId", element: <FeatureGate feature="spaces"><CourseSpacePage /></FeatureGate> },
      { path: "spaces/:spaceId/gallery", element: <FeatureGate feature="spaces"><PromptGalleryPage /></FeatureGate> },
      { path: "gallery", element: <FeatureGate feature="spaces"><PromptGalleryPage /></FeatureGate> },
      { path: "whiteboards/:whiteboardId", element: <FeatureGate feature="whiteboard"><WhiteboardPage /></FeatureGate> },
      { path: "quizzes", element: <FeatureGate feature="quizzes"><QuizzesPage /></FeatureGate> },
      { path: "quizzes/review", element: <FeatureGate feature="quizzes"><QuizReviewPage /></FeatureGate> },
      { path: "quizzes/new", element: <FeatureGate feature="quizzes"><QuizEditorPage /></FeatureGate> },
      { path: "quizzes/:quizId", element: <FeatureGate feature="quizzes"><QuizDetailPage /></FeatureGate> },
      { path: "quizzes/:quizId/edit", element: <FeatureGate feature="quizzes"><QuizEditorPage /></FeatureGate> },
      { path: "quizzes/:quizId/take", element: <FeatureGate feature="quizzes"><QuizTakePage /></FeatureGate> },
      {
        path: "quizzes/:quizId/attempts/:attemptId",
        element: <FeatureGate feature="quizzes"><QuizAttemptReviewPage /></FeatureGate>,
      },
      { path: "about", element: <AboutPage /> },
      { path: "privacy", element: <PrivacyPage /> },
      { path: "terms", element: <TermsPage /> },
      { path: "help", element: <HelpPage /> },
      { path: "tutorial", element: <TutorialPage /> },
      { path: "download", element: <DownloadPage /> },
      { path: "leaderboards", element: <FeatureGate feature="leaderboards"><LeaderboardsPage /></FeatureGate> },
      // every conversation is linkable: /chat/<conversationId>. ONE route
      // node with an optional param, so switching threads never remounts
      // the page (two separate nodes did, and raced the composer state).
      { path: "chat/:conversationId?", element: <ChatPage /> },
    ],
  },
]);

// RouteLoadingBar reads navigation state via this ref (a direct import
// here would be a module cycle through AppLayout).
setAppRouter(router);
