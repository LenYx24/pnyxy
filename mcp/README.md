# Pnyxy MCP server

Lets an AI agent (claude.ai, Claude Desktop, Claude Code, Codex) use a Pnyxy account: read the
library and documents page by page, see what the user is reading, read past AI chats, and save notes
and quizzes or organize folders. Every query runs as the user, under their row-level security.

Two ways to run it, same tools (`src/tools.ts`):

- **Remote (for users):** the `mcp` Supabase edge function (`supabase/functions/mcp`), OAuth sign-in
  through the app's `/oauth/consent` page. Users connect it from Settings > AI, which shows the URL
  and the claude.ai steps. Details in `supabase/functions/README.md`.
- **Local stdio (development):** this package, signed in with an email and password, below.

`src/tools.ts` and `src/pdf-text.ts` are loaded by both Node and Deno, so they import with `.ts`
extensions and bare package names only (the edge function maps those in its `deno.json`).

## Setup

```sh
cd mcp && pnpm install --ignore-workspace
```

Credentials come from environment variables, or from env files listed in `PNYXY_ENV_FILES`
(comma-separated, later files win):

| variable | fallback name (repo env files) |
|---|---|
| `PNYXY_SUPABASE_URL` | `VITE_SUPABASE_URL` (`../.env`) |
| `PNYXY_SUPABASE_KEY` | `VITE_SUPABASE_PUBLISHABLE_KEY` (`../.env`) |
| `PNYXY_EMAIL`, `PNYXY_PASSWORD` | `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` (`../.env.test.local`) |

For your own account put `PNYXY_EMAIL` and `PNYXY_PASSWORD` into `mcp/.env.local` (gitignored).

## Connect Claude Code

```sh
claude mcp add pnyxy \
  --env PNYXY_ENV_FILES=/abs/path/pnyxy/.env,/abs/path/pnyxy/mcp/.env.local \
  -- /abs/path/pnyxy/mcp/node_modules/.bin/tsx /abs/path/pnyxy/mcp/src/index.ts
```

Run the binary directly (not `pnpm start`): stdout carries the protocol, and a package manager's
banner on stdout breaks the handshake.

## Tools

Read: `list_library`, `search_library`, `read_document` (PDF text by page range, max 30 pages per
call), `get_reading_state`, `list_conversations`, `read_conversation`.

Write: `create_note`, `update_note` (replace or append), `create_quiz` (mcq4, multi_select,
true_false, short_answer), `create_folder`, `move_item`, `rename_item`. No tool deletes anything.
