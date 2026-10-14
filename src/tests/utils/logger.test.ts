import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import pino from "pino";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { loggerOptions, scrubSecrets, scrubUrl } from "../../utils/logger";
import { registerSecretValue } from "../../config/secrets";

function capture(): { log: pino.Logger; output: () => string } {
  let out = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return { log: pino(loggerOptions, stream), output: () => out };
}

describe("scrubUrl", () => {
  test("masks webhook and interaction path tokens and token-bearing query values", () => {
    expect(
      scrubUrl("https://discord.com/api/v10/webhooks/123/abcDEF_tok?wait=true"),
    ).toBe("https://discord.com/api/v10/webhooks/123/REDACTED?wait=true");
    expect(
      scrubUrl(
        "https://discord.com/api/v10/interactions/456/aW50ZXJhY3Rpb24/callback",
      ),
    ).toBe("https://discord.com/api/v10/interactions/456/REDACTED/callback");
    expect(scrubUrl("https://api.example.com/x?a=1&key=s3cret&b=2")).toBe(
      "https://api.example.com/x?a=1&key=REDACTED&b=2",
    );
  });
});

describe("logger redaction", () => {
  test("an error carrying a token in its URL is logged without the token", () => {
    const { log, output } = capture();
    const err = Object.assign(new Error("request failed"), {
      url: "https://discord.com/api/v10/webhooks/123/webhook-token-value",
    });
    log.error({ err }, "send failed");
    expect(output()).not.toContain("webhook-token-value");
    expect(output()).toContain("webhooks/123/REDACTED");
  });

  test("a registered secret value inside an error is replaced", () => {
    registerSecretValue("loaded-secret-value-123");
    const { log, output } = capture();
    log.error(
      { err: new Error("upstream said: bad key loaded-secret-value-123") },
      "call failed",
    );
    expect(output()).not.toContain("loaded-secret-value-123");
    expect(output()).toContain("[REDACTED]");
  });

  test("authorization headers and bot token fields are censored by path", () => {
    const { log, output } = capture();
    log.info(
      {
        req: { headers: { authorization: "Bot header-secret" } },
        entry: { name: "lisa", discordToken: "entry-token-secret" },
        discordToken: "top-token-secret",
        newToken: "rotated-token-secret",
      },
      "req"
    );
    expect(output()).not.toContain("header-secret");
    expect(output()).not.toContain("entry-token-secret");
    expect(output()).not.toContain("top-token-secret");
    expect(output()).not.toContain("rotated-token-secret");
    expect(output()).toContain("lisa");
  });

  test("a child logger keeps the redaction and scrubbing", () => {
    registerSecretValue("child-logger-token-123");
    const { log, output } = capture();
    const child = log.child({ module: "BotManager" });
    child.error(
      { err: new Error("login failed for child-logger-token-123") },
      "start failed"
    );
    child.info({ entry: { discordToken: "child-entry-token" } }, "entry");
    expect(output()).not.toContain("child-logger-token-123");
    expect(output()).not.toContain("child-entry-token");
    expect(output()).toContain('"module":"BotManager"');
  });

  test("a failed drizzle query's params and message never show a registered token", () => {
    registerSecretValue("drizzle-param-token-123");
    const { log, output } = capture();
    const err = new DrizzleQueryError(
      'insert into "bots" values (?, ?)',
      ["123", "drizzle-param-token-123"],
      new Error("UNIQUE constraint failed: bots.discord_token")
    );
    log.error({ err, applicationId: "123" }, "Failed to insert bot roster entry");
    log.error(err, "Failed to handle bot admin modal submission");
    expect(output()).not.toContain("drizzle-param-token-123");
  });
});

describe("err serializer never throws", () => {
  function logged(err: unknown): string {
    const { log, output } = capture();
    expect(() => log.error({ err }, "failed")).not.toThrow();
    return output();
  }

  test("cyclic error fields", () => {
    const ctx: Record<string, unknown> = {};
    ctx["back"] = ctx;
    const err = Object.assign(new Error("cyclic"), { ctx }) as Error & {
      self?: unknown;
    };
    err.self = err;
    expect(logged(err)).toContain("[Circular]");
  });

  test("BigInt fields", () => {
    expect(logged(Object.assign(new Error("big"), { n: 10n }))).toContain(
      '"n":"10"',
    );
  });

  test("a field whose toJSON throws", () => {
    const bad = {
      toJSON() {
        throw new Error("no");
      },
    };
    expect(logged(Object.assign(new Error("tojson"), { bad }))).toContain(
      "[Unserializable]",
    );
  });

  test.each([
    [
      'fetch "https://discord.com/api/v10/webhooks/1/quoted-webhook-tok" failed',
      "quoted-webhook-tok",
    ],
    ['GET "https://x.test/a?token=quoted-query-tok" 401', "quoted-query-tok"],
    ['header "Bearer quoted-bearer-tok" bad', "quoted-bearer-tok"],
  ])("a quoted token in the message: %s", (message, token) => {
    const out = logged(new Error(message));
    expect(out).not.toContain(token);
    expect(out).toContain("REDACTED");
  });
});

describe("message and field scrubbing", () => {
  test("an Error logged directly has its message scrubbed in msg", () => {
    const { log, output } = capture();
    log.error(
      new Error(
        "post to https://discord.com/api/v10/webhooks/1/msg-webhook-tok failed",
      ),
    );
    expect(output()).not.toContain("msg-webhook-tok");
    expect(JSON.parse(output()).msg).toContain("webhooks/1/REDACTED");
  });

  test("an { err } object without a message has the derived msg scrubbed", () => {
    const { log, output } = capture();
    log.error({ err: new Error("GET https://x.test/a?key=derived-msg-key") });
    expect(output()).not.toContain("derived-msg-key");
  });

  test("string args and top-level string fields are scrubbed", () => {
    const { log, output } = capture();
    log.info(
      { url: "https://x.test/a?access_token=field-tok" },
      "calling %s",
      "https://x.test/b?token=arg-tok",
    );
    expect(output()).not.toContain("field-tok");
    expect(output()).not.toContain("arg-tok");
  });
});

test("auth scheme scrubbing leaves ordinary prose alone", () => {
  expect(scrubUrl("using basic auth for basic setup")).toBe(
    "using basic auth for basic setup",
  );
  expect(scrubUrl("Authorization: Basic b2F1dGgyOnNlY3JldHRva2Vu")).toBe(
    "Authorization: Basic REDACTED",
  );
  expect(scrubUrl("authorization: bearer abcdefgh12345")).toBe(
    "authorization: bearer REDACTED",
  );
});

test("scrubSecrets replaces registered values in reply text", () => {
  registerSecretValue("reply-text-token-123");
  expect(scrubSecrets("Failed: params: 1,reply-text-token-123")).toBe(
    "Failed: params: 1,[REDACTED]"
  );
});

// `secrets` loads at import, so the env-loaded case needs a fresh process.
test("secrets loaded from env are scrubbed from logged errors", async () => {
  const logger = JSON.stringify(`${import.meta.dir}/../../utils/logger.ts`);
  const script = `const { default: log } = await import(${logger});
log.error({ err: new Error("bad key env-litestream-key-123 env-roster-token-123") }, "failed");`;
  const proc = Bun.spawn([process.execPath, "--no-env-file", "-e", script], {
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      LITESTREAM_SECRET_ACCESS_KEY: "env-litestream-key-123",
      BOT_1_DISCORD_TOKEN: "env-roster-token-123",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(code).toBe(0);
  expect(out).toContain("[REDACTED]");
  expect(out).not.toContain("env-litestream-key-123");
  expect(out).not.toContain("env-roster-token-123");
});
