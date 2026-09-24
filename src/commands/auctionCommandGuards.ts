import type { ChatInputCommandInteraction } from "discord.js";
import type { Auction, AuctionStatus } from "../database/auctionStore.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder } from "../utils/discord-utils.js";

export type AuctionGuardOptions = {
    allowedStatuses?: AuctionStatus[];
    requireRuntimeState?: boolean;
    requireAuctionChannel?: boolean;
};

export async function getAuctionForCommand(
    interaction: ChatInputCommandInteraction,
    auctionName: string,
    options: AuctionGuardOptions = {},
): Promise<Auction | null> {
    const auction = auctions.getByName(interaction.guildId!, auctionName);
    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** not found.` }));
        return null;
    }

    if (options.allowedStatuses && !options.allowedStatuses.includes(auction.status)) {
        const description =
            auction.status === "INIT"
                ? `Auction **${auctionName}** has not started yet.`
                : `Auction **${auctionName}** is already over.`;
        await interaction.reply(errorReplyBuilder({ description }));
        return null;
    }
    if (options.requireRuntimeState && (!auction.rules || !auction.state || !auction.channelId)) {
        await interaction.reply(
            errorReplyBuilder({
                description: `Auction **${auctionName}** is missing runtime state. Reset and start it again.`,
            }),
        );
        return null;
    }
    if (options.requireAuctionChannel && interaction.channelId !== auction.channelId) {
        await interaction.reply(
            errorReplyBuilder({
                description: `Please run this command in the auction channel <#${auction.channelId}>.`,
            }),
        );
        return null;
    }
    return auction;
}
