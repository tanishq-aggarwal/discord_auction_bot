import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";

export async function resetAuction(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);
    const auction = auctions.getByName(interaction.guildId!, auctionName);
    
    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** not found.` }));
        return;
    }

    if (auction.status === 'INIT') {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** is already in initial state.` }));
        return;
    }

    delete auction['state'];
    delete auction['currentRoundState'];
    delete auction['rules'];
    auction.channelId = null;
    auction.status = 'INIT';

    console.log(`[auction:reset] ${auction.name}`);
    await interaction.reply(replyBuilder({ description: `Auction **${auctionName}** has been reset.` }));
}