import { useRouteError, isRouteErrorResponse, Link } from "react-router";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

export function RouteErrorBoundary() {
  const error = useRouteError();

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

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle size={48} className="text-orange-400" />
      <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
      <p className="max-w-md text-sm text-text-secondary">{message}</p>
      <div className="flex gap-3 mt-2">
        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer bg-glass-bg border border-glass-border hover:bg-glass-hover text-text-primary backdrop-blur-md"
          onClick={() => window.location.reload()}
        >
          <RotateCcw size={16} />
          Reload
        </button>
        <Link
          to="/app"
          className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-200 bg-glass-bg border border-glass-border hover:bg-glass-hover text-text-primary backdrop-blur-md"
        >
          <Home size={16} />
          Go home
        </Link>
      </div>
    </div>
  );
}
