import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Compass, Home } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

/** Explicit catch-all for unknown URLs (router `path: "*"`). Friendlier than
 *  the generic RouteErrorBoundary 404, and keeps the user inside the app shell
 *  with a clear way back. */
export function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("static.notFound.title"));

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 px-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-glass-bg">
        <Compass size={28} className="text-accent" />
      </div>
      <div className="space-y-2">
        <p className="font-mono text-sm text-text-muted">404</p>
        <h1 className="text-2xl font-bold text-text-primary">
          {t("static.notFound.title")}
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          {t("static.notFound.body")}
        </p>
      </div>
      <Link
        to="/"
        className="inline-flex items-center justify-center gap-2 rounded-control bg-text-primary px-5 py-2.5 text-sm font-semibold text-bg-primary transition-all duration-200 hover:opacity-90"
      >
        <Home size={16} />
        {t("static.notFound.home")}
      </Link>
    </div>
  );
}
