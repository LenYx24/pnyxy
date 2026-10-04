# Pnyxy MCP server (local, stdio)

Lets an AI agent (Claude Code, Claude Desktop, Codex) use a Pnyxy account: read the library and
documents page by page, see what the user is reading, read past AI chats, and save notes. It signs
in as the user, so every query runs under that user's row-level security.

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

`list_library`, `search_library`, `read_document` (PDF text by page range, max 30 pages per call),
`get_reading_state`, `list_conversations`, `read_conversation`, `create_note`.
