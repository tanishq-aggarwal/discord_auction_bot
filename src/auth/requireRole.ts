import { MessageFlags, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';

type AnyInteraction = ChatInputCommandInteraction | AutocompleteInteraction;

function roleIdsFromInteractionMember(member: AnyInteraction['member']): string[] {
    const m: any = member;
    if (!m) return [];
    if (Array.isArray(m.roles)) return m.roles;                     // APIInteractionGuildMember: roles is string[]
    if (m.roles?.cache) return [...m.roles.cache.keys()]; // GuildMember: roles.cache is a Collection
    return [];
}

export async function requireSlaveWarsAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.inGuild() || !interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return false;
    }

    // if (interaction.guild?.ownerId === interaction.user.id) return true; // optional owner bypass [web:242]

    const roleId = process.env.ADMIN_ROLE_ID;
    if (!roleId) {
        await interaction.reply({
            content: 'Server config error: ADMIN_ROLE_ID is not set.',
            flags: MessageFlags.Ephemeral,
        });
        return false;
    }

    const roleIds = roleIdsFromInteractionMember(interaction.member);
    if (!roleIds.includes(roleId)) {
        await interaction.reply({
            content: 'You need the "Slave Wars Admin" role to use this command.',
            flags: MessageFlags.Ephemeral,
        });
        return false;
    }

    return true;
}
