export type GuildConfig = {
  adminRoleId: string | null;
  updatedAt: number;
  updatedByUserId: string;
};

export class GuildConfigStore {
  private byGuildId = new Map<string, GuildConfig>();

  setAdminRole(guildId: string, roleId: string, updatedByUserId: string) {
    this.byGuildId.set(guildId, {
      adminRoleId: roleId,
      updatedAt: Date.now(),
      updatedByUserId,
    });
  }

  getAdminRoleId(guildId: string): string | null {
    return this.byGuildId.get(guildId)?.adminRoleId ?? null;
  }
}