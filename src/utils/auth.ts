import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { guildConfigs } from "../database/global.js";
import { errorReplyBuilder } from "./discord-utils.js";

export function isServerAdmin(interaction: ChatInputCommandInteraction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export async function verifyAuctionAdmin(interaction: ChatInputCommandInteraction) {
    const adminRoleId = guildConfigs.getAdminRoleId(interaction.guildId!);

    if (!adminRoleId) {
        await interaction.reply(errorReplyBuilder(
            'Auction management role has not been configured yet. Ask a server admin to run the `/auction set-admin-role` command.')
        );
        return;
    }

    const roleIds: string[] = 
        interaction.member ?
            Array.isArray(interaction.member.roles)
                ? interaction.member.roles
                : [...interaction.member.roles.cache.keys()]
            : [];

    // if (isServerAdmin(interaction)) return true;
    if (roleIds.includes(adminRoleId)) return true;
    else {
        await interaction.reply(errorReplyBuilder(
            `You need the <@&${adminRoleId}> role to run this command.`
        ));
        return false;
    }
}