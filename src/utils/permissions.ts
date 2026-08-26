import { PermissionsBitField, type GuildMember } from "discord.js";

interface RuntimeConfigRepository {
  getConfig(guildId: string): Promise<{ requiredRoleIds: string[] }>;
}

/**
 * Staff permission check shared by every entry point that performs a
 * privileged modmail action (reply, close, edit pinned snippets) --
 * text commands (CommandRouter.hasPermission) and the toolbar (buttons,
 * select menus, modals, and the reply-to-toolbar shortcut) must agree on
 * who counts as staff, or one path becomes a way to bypass the other.
 */
export async function hasStaffPermission(
  runtimeConfigRepository: RuntimeConfigRepository,
  guildId: string,
  member: GuildMember | null
): Promise<boolean> {
  if (!member) {
    return false;
  }

  const runtimeConfig = await runtimeConfigRepository.getConfig(guildId);

  // Server managers always have permission
  if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return true;
  }

  // If no roles set, default requirement is Moderate Members permission
  if (runtimeConfig.requiredRoleIds.length === 0) {
    return member.permissions.has(PermissionsBitField.Flags.ModerateMembers);
  }

  // Check if user has ANY of the required roles
  for (const roleId of runtimeConfig.requiredRoleIds) {
    if (member.roles.cache.has(roleId)) {
      return true;
    }
  }

  return false;
}
