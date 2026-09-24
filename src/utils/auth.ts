import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { guildConfigs } from "../database/global.js";
import { errorReplyBuilder } from "./discord-utils.js";

export function isServerAdmin(interaction: ChatInputCommandInteraction) {
    return (
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    );
}

export function getMemberRoleIds(member: ChatInputCommandInteraction["member"]): string[] {
    if (!member) return [];
    return Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
}

export async function verifyAuctionAdmin(interaction: ChatInputCommandInteraction) {
    const adminRoleId = guildConfigs.getAdminRoleId(interaction.guildId!);

    if (!adminRoleId) {
        await interaction.reply(
            errorReplyBuilder({
                description:
                    "Auction management role has not been configured yet. Ask a server admin to run the `/auction set-admin-role` command.",
            }),
        );
        return;
    }

    if (getMemberRoleIds(interaction.member).includes(adminRoleId)) return true;
    else {
        await interaction.reply(
            errorReplyBuilder({ description: `You need the <@&${adminRoleId}> role to run this command.` }),
        );
        return false;
    }
}
