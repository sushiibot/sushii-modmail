export function formatUserIdentity(
  userId: string,
  username: string,
  nickname?: string | null
): string {
  let identity = `<@${userId}> - @${username} (ID: ${userId})`;

  if (nickname) {
    identity = `${nickname} ~ ${identity}`;
  }

  return identity;
}
