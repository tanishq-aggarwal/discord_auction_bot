export type GuildConfig = {
    adminRoleId: string | null;
};

type SerializableGuildConfigsByGuild = Record<string, GuildConfig>;

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

    toSerializable(): SerializableGuildConfigsByGuild {
        return Object.fromEntries(this.byGuildId.entries());
    }

    hydrate(serialized: SerializableGuildConfigsByGuild): void {
        this.byGuildId = new Map(Object.entries(serialized ?? {}));
    }
}