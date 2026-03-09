import type { ChatInputCommandInteraction } from "discord.js";
import type { Auction, Master, RoundState } from "../database/auctionStore.js";
import { auctions, persistState } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";

function getRoundWinner(round: RoundState): { winnerId: Master["id"]; winningBid: number } | null {
    const bids = Array.from(round.bids.entries());
    if (!bids.length) return null;

    const highestBid = Math.max(...bids.map(([, bid]) => bid.amount));
    const tiedMasterIds = bids
        .filter(([, bid]) => bid.amount === highestBid)
        .map(([masterId]) => masterId);

    const winnerId = round.priorityOrder.find(masterId => tiedMasterIds.includes(masterId)) ?? tiedMasterIds[0] ?? null;
    if (!winnerId) return null;
    return { winnerId, winningBid: highestBid };
}

function rollbackWinnerState(auction: Auction, round: RoundState, winnerId: string, winningBid: number): boolean {
    const purchases = auction.state!.purchases.get(winnerId);
    if (!purchases) return false;

    const nomineeIndex = purchases.lastIndexOf(round.nomineeId);
    if (nomineeIndex === -1) return false;

    purchases.splice(nomineeIndex, 1);
    const currentBalance = auction.state!.balances.get(winnerId) ?? 0;
    auction.state!.balances.set(winnerId, currentBalance + winningBid);
    return true;
}

export async function undoLastRound(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);
    const auction = auctions.getByName(interaction.guildId!, auctionName);

    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** not found.` }));
        return;
    }

    if (auction.status === "INIT") {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** has not started yet.` }));
        return;
    }

    if (!auction.state) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** is missing state data. Try resetting and starting it again.` }));
        return;
    }

    if (auction.currentRoundState) {
        await interaction.reply(errorReplyBuilder({
            description: "A new round is currently ongoing. Run `/auction cancel-current-round` first before running this command.",
        }));
        return;
    }

    const lastRound = auction.lastRoundState;
    if (!lastRound) {
        await interaction.reply(errorReplyBuilder({ description: "There is no previous round to undo." }));
        return;
    }

    if (interaction.channelId !== auction.channelId) {
        await interaction.reply(errorReplyBuilder({ description: `Please run this command in the auction channel <#${auction.channelId}>.` }));
        return;
    }

    const winningResult = getRoundWinner(lastRound);
    if (!winningResult) {
        delete auction.lastRoundState;
        persistState();
        await interaction.reply(replyBuilder({
            description: `Previous round for <@${lastRound.nomineeId}> had no winning bid, so there were no state changes to revert.`,
        }));
        return;
    }

    const reverted = rollbackWinnerState(auction, lastRound, winningResult.winnerId, winningResult.winningBid);
    if (!reverted) {
        await interaction.reply(errorReplyBuilder({
            description: "Could not undo the previous round because the expected purchase was not found in auction state.",
        }));
        return;
    }

    delete auction.lastRoundState;

    if (auction.status === "CLOSED") {
        auction.status = "LIVE";
        delete auction.state.endedAt;
    }
    persistState();

    console.log(`[auction:undo-last-round] auction=${auction.name} nominee=${lastRound.nomineeTag ?? lastRound.nomineeId} winner=${winningResult.winnerId} bid=${winningResult.winningBid}`);
    await interaction.reply(replyBuilder({
        description: `Reverted the previous round.\n\n- **Slave:** <@${lastRound.nomineeId}>\n- **Was bought by:** <@${winningResult.winnerId}>\n- **Coins restored:** ${winningResult.winningBid}🪙`,
        color: "blue-400",
    }));
}
