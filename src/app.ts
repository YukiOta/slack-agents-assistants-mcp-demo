import type AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { App, Assistant, AwsLambdaReceiver, LogLevel } from "@slack/bolt";
import type { AwsEvent } from "@slack/bolt/dist/receivers/AwsLambdaReceiver";
import type {
  APIGatewayEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { getClient } from "./lib/claude/client";
import { callTool, getTools, mcpClientConnect } from "./mcp-client/notion";
import { getSystemPrompt } from "./util/prompts";

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
  logLevel: LogLevel.INFO,
});

const assistant = new Assistant({
  threadStarted: async ({ logger, say }) => {
    try {
      await say("こんにちは！何でも聞いて下さい。");
    } catch (e) {
      logger.error(e);
    }
  },

  userMessage: async ({ say, logger, setStatus, message, client }) => {
    setStatus("入力中...");

    try {
      if (message.subtype !== undefined || !message.text) return;

      // メッセージ送信者のSlackユーザー名を取得する
      const result = await client.users.info({
        user: message.user,
      });
      const userName =
        result.user?.profile?.real_name ||
        result.user?.profile?.display_name ||
        "";

      const messages: Anthropic.Messages.MessageParam[] = [];

      // スレッド内のメッセージをコンテキストとして追加するために、メッセージを取得する
      const thread = await client.conversations.replies({
        channel: message.channel,
        ts: message.thread_ts!,
      });
      const threadHistory = (thread.messages || [])
        .filter((m) => !m.text?.startsWith("--")) // ツールの実行結果を除外
        .map((m) => {
          const role = m.bot_id ? "assistant" : "user";
          return { role, content: m.text };
        }) as Anthropic.Messages.MessageParam[];
      messages.push(...threadHistory);

      let isContinue = true;
      while (isContinue) {
        if (!llmClient) {
          throw new Error("Failed to initialize LLM client");
        }

        const res = await llmClient.messages.create({
          system: getSystemPrompt({ userName }),
          max_tokens: 1024,
          messages,
          model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
          tools,
        });

        for await (const content of res.content) {
          switch (content.type) {
            case "text": {
              messages.push({ role: "assistant", content: content.text });
              await say(content.text);
              continue;
            }
            case "tool_use": {
              messages.push({
                role: "assistant",
                content: [
                  {
                    type: "tool_use",
                    id: content.id,
                    name: content.name,
                    input: content.input,
                  },
                ],
              });
              await say(`-- 🔧 ツールを実行します: ${content.name}`);
              const toolResult = await callTool(content);
              await say("-- ✅ ツールの実行が完了しました。");
              messages.push({
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: content.id,
                    content: toolResult.content
                      .filter((c) => c.type === "text")
                      .map((c) => {
                        return { type: "text", text: c.text };
                      }),
                  },
                ],
              });
              continue;
            }
          }
        }

        switch (res.stop_reason) {
          case "max_tokens": {
            await say("⚠️ トークン数の上限に達しました。");
            isContinue = false;
            break;
          }
          case "end_turn": {
            isContinue = false;
            break;
          }
          case "stop_sequence": {
            isContinue = false;
            break;
          }
          case "tool_use": {
            isContinue = true;
            break;
          }
        }
      }
    } catch (error) {
      logger.error(error);
    }
  },
});

app.assistant(assistant);

let llmClient: AnthropicBedrock | null = null;
let isMcpConnected = false;
let tools: Anthropic.Messages.Tool[] = [];

const main = async () => {
  try {
    // Claude のクライアントを初期化
    if (!llmClient) {
      llmClient = await getClient();
    }
    // MCP クライアントを初期化
    if (!isMcpConnected) {
      await mcpClientConnect();
      tools = await getTools();
      isMcpConnected = true;
    }

    await app.start();
    app.logger.info("⚡️ Bolt app is running!");
  } catch (error) {
    app.logger.error("Failed to start the app", error);
  }
};

// Handle the Lambda function event
export const handler = async (
  event: APIGatewayEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  // Slack のリトライを検出
  const headers = event.headers || {};
  if (headers["X-Slack-Retry-Num"]) {
    console.log(`Ignoring retry request: ${headers["X-Slack-Retry-Reason"]}`);
    return { statusCode: 200, body: "" }; // 200 を返してリトライ停止
  }

  await main();
  const lambdaHandler = await awsLambdaReceiver.start();
  return lambdaHandler(event as AwsEvent, context, () => {});
};
