export class GuildOwnershipConflictError extends Error {
  constructor(
    public readonly guildId: string,
    public readonly expectedApplicationId: string,
    public readonly actualApplicationId: string
  ) {
    super(
      `Guild ${guildId} is owned by application ${actualApplicationId}, ` +
        `not ${expectedApplicationId}`
    );
    this.name = "GuildOwnershipConflictError";
  }
}
