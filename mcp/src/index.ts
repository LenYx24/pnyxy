import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openSession } from "./session.ts";
import { registerTools, SERVER_INSTRUCTIONS } from "./tools.ts";

const session = await openSession();
const server = new McpServer(
  { name: "pnyxy", version: "0.2.0" },
  { instructions: SERVER_INSTRUCTIONS },
);
registerTools(server, session);
await server.connect(new StdioServerTransport());
// stdout carries the protocol, so diagnostics go to stderr
console.error("pnyxy MCP ready");
