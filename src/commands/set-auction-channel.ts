import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, infoReplyBuilder } from "../utils/discord-utils.js";

export async function setAuctionChannel(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);
    const channel = interaction.options.getChannel('channel', true);

    try {
        const auction = auctions.setAuctionChannel(interaction.guildId!, auctionName, channel.id);
        console.log(`[auction:set-auction-channel] guild=${interaction.guildId!} auction=${auctionName} channel=${channel.name}`);
        await interaction.reply(infoReplyBuilder({
            description: `**${auction.name}** auction channel has been set to **${channel.name}**.`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to set auction channel. Please try again.';
        await interaction.reply(errorReplyBuilder({message}));
    }
}