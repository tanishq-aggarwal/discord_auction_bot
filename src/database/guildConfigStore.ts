export type GuildConfig = {
    adminRoleId: string | null;
};

export class GuildConfigStore {
    private byGuildId = new Map<string, GuildConfig>();

    setAdminRoleId(guildId: string, roleId: string) {
        this.byGuildId.set(guildId, {
            adminRoleId: roleId
        });
    }

    getAdminRoleId(guildId: string): string | null {
        return this.byGuildId.get(guildId)?.adminRoleId ?? null;
    }
}