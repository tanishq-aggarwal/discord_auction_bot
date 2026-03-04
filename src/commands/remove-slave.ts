import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, infoReplyBuilder } from "../utils/discord-utils.js";

export async function removeSlave(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);
    const slave = interaction.options.getUser('slave', true);

    try {
        const auction = auctions.removeSlave(interaction.guildId!, auctionName, slave.id, slave.tag);
        console.log(`[auction:remove-slave] guild=${interaction.guildId!} auction=${auctionName} slave=${slave.tag} (${slave.id})`);
        await interaction.reply(infoReplyBuilder(
            `Removed **${slave.tag}** from **${auction.name}** slave pool.`,
        ));
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to remove slave.';
        await interaction.reply(errorReplyBuilder(msg));
    }
}