import type { ChatInputCommandInteraction } from "discord.js";
import { resetAuctionState } from "../domain/auctionLifecycle.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";
import { getAuctionForCommand } from "./auctionCommandGuards.js";

export async function resetAuction(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);
    const auction = await getAuctionForCommand(interaction, auctionName);
    if (!auction) return;

    if (auction.status === "INIT") {
        await interaction.reply(
            errorReplyBuilder({ description: `Auction **${auctionName}** is already in initial state.` }),
        );
        return;
    }

    resetAuctionState(auction);

    console.log(`[auction:reset] ${auction.name}`);
    await interaction.reply(replyBuilder({ description: `Auction **${auctionName}** has been reset.` }));
}
