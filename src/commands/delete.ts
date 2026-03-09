import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";

export async function deleteAuction(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);

    try {
        const auction = auctions.delete(interaction.guildId!, auctionName);
        console.log(`[auction:delete] guild=${interaction.guildId!} auction=${auctionName}`);
        await interaction.reply(replyBuilder({
            description: `Auction **${auction.name}** has been deleted.`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete auction.';
        await interaction.reply(errorReplyBuilder({ description: message }));
    }
}
