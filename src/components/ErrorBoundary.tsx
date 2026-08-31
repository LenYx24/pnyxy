import { useEffect } from "react";
import { useRouteError, isRouteErrorResponse, Link, useLocation } from "react-router";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { reportClientError } from "@/lib/error-report";

export function RouteErrorBoundary() {
  const error = useRouteError();
  const location = useLocation();

  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message =
      error.status === 404
        ? "The page you're looking for doesn't exist."
        : error.data?.toString() ?? message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  // This is the app's only error boundary (react-router's errorElement,
  // not a class componentDidCatch): report once per boundary mount, with
  // the error's own stack standing in for a component stack.
  useEffect(() => {
    void reportClientError({
      kind: "crash",
      message,
      route: location.pathname,
      context: {
        stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
        status: isRouteErrorResponse(error) ? error.status : undefined,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle size={48} className="text-orange-400" />
      <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
      <p className="max-w-md text-sm text-text-secondary">{message}</p>
      <div className="flex gap-3 mt-2">
        <button
          className="inline-flex items-center justify-center gap-2 rounded-control px-5 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer bg-bg-tertiary hover:bg-surface-3 text-text-primary"
          onClick={() => window.location.reload()}
        >
          <RotateCcw size={16} />
          Reload
        </button>
        <Link
          to="/"
          className="inline-flex items-center justify-center gap-2 rounded-control px-5 py-2.5 text-sm font-medium transition-all duration-200 bg-bg-tertiary hover:bg-surface-3 text-text-primary"
        >
          <Home size={16} />
          Go home
        </Link>
      </div>
    </div>
  );
}
