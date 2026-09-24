export type GuildConfig = {
    adminRoleId: string | null;
};

type SerializableGuildConfigsByGuild = Record<string, GuildConfig>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class GuildConfigStore {
    private byGuildId = new Map<string, GuildConfig>();

    setAdminRoleId(guildId: string, roleId: string) {
        this.byGuildId.set(guildId, {
            adminRoleId: roleId,
        });
    }

    getAdminRoleId(guildId: string): string | null {
        return this.byGuildId.get(guildId)?.adminRoleId ?? null;
    }

    toSerializable(): SerializableGuildConfigsByGuild {
        return Object.fromEntries(this.byGuildId.entries());
    }

    hydrate(serialized: unknown): void {
        if (!isRecord(serialized)) {
            throw new Error("Persisted guild configuration must be an object.");
        }

        const entries: Array<[string, GuildConfig]> = [];
        for (const [guildId, value] of Object.entries(serialized)) {
            if (!isRecord(value) || (value.adminRoleId !== null && typeof value.adminRoleId !== "string")) {
                throw new Error(`Persisted guild configuration for "${guildId}" is invalid.`);
            }
            entries.push([guildId, { adminRoleId: value.adminRoleId }]);
        }
        this.byGuildId = new Map(entries);
    }
}
