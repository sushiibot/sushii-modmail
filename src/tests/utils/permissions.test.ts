import { describe, expect, it, mock } from "bun:test";
import { PermissionsBitField } from "discord.js";
import { hasStaffPermission } from "../../utils/permissions";

function mockMember(overrides: {
  hasManageGuild?: boolean;
  hasModerateMembers?: boolean;
  roleIds?: string[];
} = {}) {
  const roleIds = overrides.roleIds ?? [];
  return {
    permissions: {
      has: (flag: bigint) => {
        if (flag === PermissionsBitField.Flags.ManageGuild) {
          return overrides.hasManageGuild ?? false;
        }
        if (flag === PermissionsBitField.Flags.ModerateMembers) {
          return overrides.hasModerateMembers ?? false;
        }
        return false;
      },
    },
    roles: { cache: new Map(roleIds.map((id) => [id, { id }])) },
  } as any;
}

describe("hasStaffPermission", () => {
  it("denies a null member", async () => {
    const runtimeConfigRepository = {
      getConfig: mock().mockResolvedValue({ requiredRoleIds: [] }),
    };

    const result = await hasStaffPermission(
      runtimeConfigRepository,
      "guild-1",
      null
    );

    expect(result).toBe(false);
  });

  it("allows a member with ManageGuild regardless of requiredRoleIds", async () => {
    const runtimeConfigRepository = {
      getConfig: mock().mockResolvedValue({ requiredRoleIds: ["role-a"] }),
    };
    const member = mockMember({ hasManageGuild: true });

    const result = await hasStaffPermission(
      runtimeConfigRepository,
      "guild-1",
      member
    );

    expect(result).toBe(true);
  });

  it("falls back to ModerateMembers when no roles are configured", async () => {
    const runtimeConfigRepository = {
      getConfig: mock().mockResolvedValue({ requiredRoleIds: [] }),
    };

    const permitted = await hasStaffPermission(
      runtimeConfigRepository,
      "guild-1",
      mockMember({ hasModerateMembers: true })
    );
    const denied = await hasStaffPermission(
      runtimeConfigRepository,
      "guild-1",
      mockMember({ hasModerateMembers: false })
    );

    expect(permitted).toBe(true);
    expect(denied).toBe(false);
  });

  it("requires one of the configured roles when requiredRoleIds is non-empty, ignoring ModerateMembers", async () => {
    const runtimeConfigRepository = {
      getConfig: mock().mockResolvedValue({ requiredRoleIds: ["role-a", "role-b"] }),
    };

    // Has ModerateMembers but none of the required roles -- should be denied,
    // since configuring requiredRoleIds narrows the default permission.
    const deniedDespiteModerate = await hasStaffPermission(
      runtimeConfigRepository,
      "guild-1",
      mockMember({ hasModerateMembers: true, roleIds: ["unrelated-role"] })
    );
    const permitted = await hasStaffPermission(
      runtimeConfigRepository,
      "guild-1",
      mockMember({ roleIds: ["role-b"] })
    );

    expect(deniedDespiteModerate).toBe(false);
    expect(permitted).toBe(true);
  });
});
