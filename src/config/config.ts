import { z } from "zod";

const configSchema = z.object({
  LOG_LEVEL: z.string().optional().default("info"),

  // Legacy single-bot identity vars. Optional at the schema level -- they
  // remain a fully supported way to run one bot (EnvBotRegistry's legacy
  // fallback), used when no BOT_1_* numbered roster vars are present.
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  MAIL_GUILD_ID: z.string().optional(),

  DATABASE_URI: z.string(),

  // Healthcheck server port
  HEALTHCHECK_PORT: z.coerce.number().optional().default(3000),

  // Build information
  GIT_HASH: z.string().optional(),
  BUILD_DATE: z.coerce.date().optional(),
});

export type ConfigType = z.infer<typeof configSchema>;

export function getConfigFromEnv(): ConfigType {
  const config = configSchema.safeParse(process.env);

  if (!config.success) {
    throw new Error(`Invalid environment variables: ${config.error}`);
  }

  return config.data;
}
