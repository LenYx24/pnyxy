# Contributing to Pnyxy

Pnyxy is a student / solo project, so contributions are welcome but the bar
and direction are set by the maintainer. Issues and PRs are both fair game —
issues are cheaper if you're not sure the change will land.

## Dev setup

```sh
git clone <repo-url>
cd pnyxy
pnpm install
cp .env.example .env   # fill in your own Supabase project if you have one
pnpm dev
```

Node 22+ and pnpm 10+ required. See the main [README](./README.md) for the
full setup (Supabase linking, auth templates, Google OAuth, Tauri builds).

## Before you open a PR

```sh
pnpm lint        # ESLint
pnpm build       # TypeScript + Vite production build
pnpm test        # Vitest
```

All three should pass. CI runs lint + build on every push.

## Style

- TypeScript everywhere, strict mode.
- Tailwind classes for styling; CSS custom properties for themeable tokens
  (see `src/styles/index.css`).
- Zustand for client state, IndexedDB (`idb`) for local-only data, Supabase
  for anything that needs to sync.
- Keep features modular under `src/features/<name>/`.

## What's in scope

- Bug fixes
- Reader / library / annotation improvements
- Accessibility fixes
- New themes (see the Themes & Plugins section in the README)
- Documentation

## What probably isn't

- Large architectural rewrites without a prior issue discussion
- Features that require new paid infrastructure
- Features that only make sense for a specific institution or workflow —
  build those as plugins instead

## Security issues

Please report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).
Don't open public issues for them.

## Licensing

By contributing you agree that your contribution will be released under the
[MIT License](./LICENSE) that covers the rest of the project.
