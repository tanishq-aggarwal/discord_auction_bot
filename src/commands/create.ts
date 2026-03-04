import { type ChatInputCommandInteraction } from "discord.js";
import { errorReplyBuilder, infoReplyBuilder } from "../utils/discord-utils.js";
import { auctions } from "../database/global.js";


export async function createAuction(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);

    try {
        const auction = auctions.create(
            interaction.guildId!,
            auctionName,
            interaction.channelId!
        );

        console.log(`[auction:create] guild=${interaction.guildId} auction=${auctionName}`);
        await interaction.reply(infoReplyBuilder({
            description: `Auction **${auction.name}** created.`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create auction.';
        await interaction.reply(errorReplyBuilder({message}));
    }
}