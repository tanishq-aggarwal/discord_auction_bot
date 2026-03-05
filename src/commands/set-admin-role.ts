import { type ChatInputCommandInteraction } from "discord.js";
import { replyBuilder } from "../utils/discord-utils.js";
import { guildConfigs } from "../database/global.js";


export async function setAdminRole(interaction: ChatInputCommandInteraction) {
    const role = interaction.options.getRole('role', true);

    guildConfigs.setAdminRoleId(interaction.guildId!, role.id);

    console.log(`[auction:set-admin-role] guild=${interaction.guildId} role=${role.name} (${role.id})`);
    await interaction.reply(replyBuilder({
        description: `Auction management enabled for role **${role.name}**.`,
    }));
}