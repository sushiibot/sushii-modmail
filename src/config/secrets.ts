import { readFileSync } from "node:fs";
import { z } from "zod";

// All optional: bot tokens normally live in the `bots` table, and LITESTREAM_* is read by litestream
// itself; they're loaded here so their values are scrubbed from logs.
const optional = z.string().min(1).optional();

const schema = z.object({
  DISCORD_TOKEN: optional,
  LITESTREAM_ACCESS_KEY_ID: optional,
  LITESTREAM_SECRET_ACCESS_KEY: optional,
});

export type Secrets = Readonly<z.infer<typeof schema>>;
export type SecretName = keyof Secrets;

const ROSTER_TOKEN = /^(BOT_\d+_DISCORD_TOKEN)(?:_FILE)?$/;

const extraValues = new Set<string>();

/** One secret by name, with the NAME_FILE fallback; empty counts as unset. */
export function readSecret(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const file = env[`${name}_FILE`];
  if (!file) return env[name] || undefined;
  try {
    return readFileSync(file, "utf8").trimEnd() || undefined;
  } catch (err) {
    throw new Error(
      `${name}_FILE could not be read (${(err as NodeJS.ErrnoException).code})`
    );
  }
}

/** Adds a value obtained at runtime (a DB-held or newly entered bot token) to log scrubbing. */
export function registerSecretValue(value: string): void {
  extraValues.add(value);
  const trimmed = value.trim();
  if (trimmed !== value) extraValues.add(trimmed);
}

/** Zod issues as `path (code)` only: some zod messages echo the received value. */
export function issueNames(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")} (${i.code})`).join(", ");
}

export function loadSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  const raw = Object.fromEntries(
    Object.keys(schema.shape).map((k) => [k, readSecret(k, env)])
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Missing or invalid secrets: ${issueNames(parsed.error)}`);
  }
  return Object.freeze(parsed.data);
}

export const secrets = loadSecrets();

/** Registers every BOT_N_DISCORD_TOKEN in env, so scrubbing covers them before the roster is read. */
export function registerEnvRosterTokens(
  env: NodeJS.ProcessEnv = process.env
): void {
  for (const key of Object.keys(env)) {
    const name = ROSTER_TOKEN.exec(key)?.[1];
    if (!name) continue;
    try {
      const value = readSecret(name, env);
      if (value) registerSecretValue(value);
    } catch {
      // EnvBotRegistry reports an unreadable file if the roster is actually read.
    }
  }
}

registerEnvRosterTokens();

export function requireSecret(
  name: SecretName,
  loaded: Secrets = secrets
): string {
  const value = loaded[name];
  if (!value) throw new Error(`Missing required secrets: ${name}`);
  return value;
}

export function knownSecretValues(): string[] {
  return [...Object.values(secrets), ...extraValues].filter(
    (v): v is string => typeof v === "string" && v.length >= 8
  );
}
