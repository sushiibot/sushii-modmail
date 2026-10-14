import { z } from "zod";

const configSchema = z.object({
  LOG_LEVEL: z.string().optional().default("info"),

  // Legacy single-bot guild id; EnvBotRegistry pairs it with DISCORD_TOKEN
  // (config/secrets) when no BOT_1_* roster vars are present.
  MAIL_GUILD_ID: z.string().optional(),

  DATABASE_URI: z.string(),

  // Healthcheck server port
  HEALTHCHECK_PORT: z.coerce.number().optional().default(3000),

  // Build information
  GIT_HASH: z.string().optional(),
  BUILD_DATE: z.coerce.date().optional(),

  // Discord user id allowed to use owner-only `bot` commands. Left unset,
  // those commands are registered but unreachable rather than absent.
  OWNER_USER_ID: z.string().optional(),
});

export type ConfigType = z.infer<typeof configSchema>;

export function getConfigFromEnv(): ConfigType {
  const config = configSchema.safeParse(process.env);

  if (!config.success) {
    // Names and issue codes only: some zod messages echo the received value.
    const names = config.error.issues.map(
      (i) => `${i.path.join(".")} (${i.code})`
    );
    throw new Error(`Invalid environment variables: ${names.join(", ")}`);
  }

  return config.data;
}
