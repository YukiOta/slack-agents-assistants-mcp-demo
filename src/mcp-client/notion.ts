import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

const transport = new StdioClientTransport({
  command: "node",
  args: [
    "dist/mcp-server.js",
  ],
  env: {
    NOTION_API_TOKEN: process.env.NOTION_API_TOKEN!,
    PATH: process.env.PATH!,
  },
});

const client = new Client(
  {
    name: "notion-client",
    version: "1.0.0",
  },
  {
    capabilities: {
      prompts: {},
      resources: {},
      tools: {},
    },
  },
);

export const mcpClientConnect = async () => {
  await client.connect(transport);
};

export const getTools = async (): Promise<Anthropic.Messages.Tool[]> => {
  const response = await client.request(
    {
      method: "tools/list",
    },
    ListToolsResultSchema,
  );

  const tools: Anthropic.Messages.Tool[] = response.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  return tools;
};

export const callTool = async (content: Anthropic.Messages.ToolUseBlock) => {
  return await client.request(
    {
      method: "tools/call",
      params: {
        name: content.name,
        arguments: content.input,
      },
    },
    CallToolResultSchema,
  );
};
