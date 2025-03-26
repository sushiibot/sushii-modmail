import { z } from "zod";

const configSchema = z.object({
  LOG_LEVEL: z.string().optional().default("info"),

  DISCORD_TOKEN: z.string(),
  DISCORD_CLIENT_ID: z.string(),

  PREFIX: z.string().optional(),

  // Where modmails get sent to
  MAIL_GUILD_ID: z.string(),
  FORUM_CHANNEL_ID: z.string(),

  ANONYMOUS_SNIPPETS: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),

  DATABASE_URI: z.string(),

  INITIAL_MESSAGE: z.string().optional(),
});

export type ConfigType = z.infer<typeof configSchema>;

export function getConfigFromEnv(): ConfigType {
  const config = configSchema.safeParse(process.env);

  if (!config.success) {
    throw new Error(`Invalid environment variables: ${config.error}`);
  }

  return config.data;
}
