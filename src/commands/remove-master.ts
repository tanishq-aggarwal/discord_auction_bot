import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, infoReplyBuilder } from "../utils/discord-utils.js";

export async function removeMaster(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);
    const master = interaction.options.getUser('master', true);

    try {
        const auction = auctions.removeMaster(interaction.guildId!, auctionName, master.id, master.tag);
        console.log(`[auction:remove-master] guild=${interaction.guildId!} auction=${auctionName} master=${master.tag} (${master.id})`);
        await interaction.reply(infoReplyBuilder(
            `Removed **${master.tag}** from **${auction.name}** bidder pool.`,
        ));
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to remove master.';
        await interaction.reply(errorReplyBuilder(msg));
    }
}