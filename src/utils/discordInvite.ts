const BOT_PERMISSIONS = 515396455488;

export function buildInviteLink(applicationId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&permissions=${BOT_PERMISSIONS}&integration_type=0&scope=applications.commands+bot`;
}
