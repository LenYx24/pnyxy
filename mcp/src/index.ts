import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openSession } from "./session.js";
import { registerTools } from "./tools.js";

const session = await openSession();
const server = new McpServer({ name: "pnyxy", version: "0.1.0" });
registerTools(server, session);
await server.connect(new StdioServerTransport());
// stdout carries the protocol, so diagnostics go to stderr
console.error("pnyxy MCP ready");
