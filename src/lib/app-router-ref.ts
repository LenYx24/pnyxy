/**
 * Late-bound handle to the app's data router. RouteLoadingBar needs
 * router.subscribe() to see a navigation the moment it starts (React
 * keeps the old page committed while the next lazy chunk loads, so
 * useLocation alone never reports the pending state). Importing the
 * router directly from AppLayout would be a module cycle
 * (router.tsx -> AppLayout -> router.tsx), hence this ref.
 */

export interface AppRouterLike {
  subscribe: (
    fn: (state: {
      location: { pathname: string; search: string };
    }) => void,
  ) => () => void;
}

let appRouter: AppRouterLike | null = null;

export function setAppRouter(r: AppRouterLike): void {
  appRouter = r;
}

export function getAppRouter(): AppRouterLike | null {
  return appRouter;
}
