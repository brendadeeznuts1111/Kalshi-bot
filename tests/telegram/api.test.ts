import { afterEach, describe, expect, test } from "bun:test";
import { sendMessage } from "../../src/telegram/api.ts";

const originalFetch = globalThis.fetch;
const originalToken = Bun.env.TELEGRAM_BOT_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete Bun.env.TELEGRAM_BOT_TOKEN;
  else Bun.env.TELEGRAM_BOT_TOKEN = originalToken;
});

describe("Telegram API boundary", () => {
  test("can be imported without a token and fails only when called", async () => {
    delete Bun.env.TELEGRAM_BOT_TOKEN;
    expect(sendMessage(-123, "hello")).rejects.toThrow("TELEGRAM_BOT_TOKEN not set");
  });

  test("sends topic and reply identity and returns the Telegram message", async () => {
    Bun.env.TELEGRAM_BOT_TOKEN = "test-token";
    const capturedBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        ok: true,
        result: {
          message_id: 44,
          message_thread_id: 7,
          chat: { id: -123, type: "supergroup" },
          date: 1_700_000_000,
          text: "hello",
        },
      });
    }) as typeof fetch;

    const message = await sendMessage("-123", "hello", {
      parseMode: "HTML",
      messageThreadId: 7,
      replyToMessageId: 43,
    });

    expect(message.message_id).toBe(44);
    expect(capturedBodies[0]).toEqual({
      chat_id: "-123",
      text: "hello",
      parse_mode: "HTML",
      message_thread_id: 7,
      reply_parameters: { message_id: 43 },
    });
  });
});
