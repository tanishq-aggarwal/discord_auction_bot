import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { Auction, Master, RoundState } from "../database/auctionStore.js";
import {
    areAllBidsReceived,
    computeMaxBidAllowed,
    getEligibleMasterIdsForRound,
    getRemainingSlots,
} from "../domain/roundRules.js";
import { auctionCustomIds } from "../interactions/auctionCustomIds.js";
import { colorsMap, getRelativeDiscordTimestamp } from "../utils/discord-utils.js";

export const BID_REVEAL_DELAY_MS = 15_000;

export function buildMasterOverviewEmbed(auction: Auction, masterId: Master["id"]): EmbedBuilder {
    const balance = auction.state?.balances.get(masterId) ?? 0;
    const remainingSlots = getRemainingSlots(auction, masterId);
    const maxSlaves = auction.rules?.maxSlavesPerMaster ?? 0;
    const purchasedSlaveIds = auction.state?.purchases.get(masterId) ?? [];
    const purchasesSoFar = purchasedSlaveIds.length
        ? purchasedSlaveIds
              .map((slaveId) => {
                  const slave = auction.slaves.get(slaveId);
                  return slave ? `- <@${slaveId}> (${slave.specialty.toLowerCase()})` : `- <@${slaveId}>`;
              })
              .join("\n")
        : "_- No purchases made yet_";

    const embed = new EmbedBuilder()
        .setColor(colorsMap["yellow-400"])
        .setTitle("📋 Your Auction Summary")
        .setDescription(
            `**Your Team So Far:**\n${purchasesSoFar}\n\n` +
                `**Current Balance:** ${balance}🪙\n` +
                `**Remaining Purchases:** ${remainingSlots}/${maxSlaves}\n`,
        );
    if (remainingSlots > 1) {
        embed.setFooter({
            text: `⚠️ You must keep at least ${balance - computeMaxBidAllowed(auction, masterId)}🪙 reserved for future purchases.`,
        });
    }
    return embed;
}

export function createOverviewActionRow(auctionId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(auctionCustomIds.placeBid.build(auctionId))
            .setLabel("Place bid")
            .setStyle(ButtonStyle.Success),
    );
}

export function buildAllBidsReceivedEmbed(round: RoundState): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(colorsMap["blue-400"])
        .setDescription(
            `⌛ Bidding closed for <@${round.nomineeId}>! Revealing the results ${getRelativeDiscordTimestamp(Date.now() + BID_REVEAL_DELAY_MS)}... 🥁`,
        );
}

export function buildRoundRevealEmbed(
    auction: Auction,
    round: RoundState,
    winnerId: string,
    winningBid: number,
): EmbedBuilder {
    const nominee = auction.slaves.get(round.nomineeId);
    const bidsList = Array.from(auction.masters.keys())
        .filter((masterId) => round.bids.has(masterId))
        .map((masterId) => {
            const bid = round.bids.get(masterId)!;
            return `- <@${masterId}> — **${bid.amount}**🪙${bid.isAuto ? " (auto)" : ""}`;
        })
        .join("\n");

    return new EmbedBuilder()
        .setColor(colorsMap["violet-500"])
        .setTitle(`🔔 Results for ${nominee?.tag ?? `<@${round.nomineeId}>`} 🔔`)
        .setDescription(
            `\nThe bids are in for <@${round.nomineeId}>!\n\n` +
                `${bidsList}\n\n` +
                `**🔨 Going once... going twice... and SOLD! to <@${winnerId}> for ${winningBid}🪙**`,
        )
        .setThumbnail(round.nomineeAvatarURL ?? null);
}

function buildBidProgressString(auction: Auction, round: RoundState): string {
    const eligibleMasterIds = getEligibleMasterIdsForRound(auction, round);
    if (!eligibleMasterIds.length) return "_- No eligible bidders this round_";

    return eligibleMasterIds
        .map((masterId) => {
            const bid = round.bids.get(masterId);
            if (!bid) return `- <@${masterId}> — \`❌ pending\``;
            return bid.isAuto ? `- <@${masterId}> — \`⏳ auto-submitted\`` : `- <@${masterId}> — \`✅ received\``;
        })
        .join("\n");
}

export function buildBiddingRoundEmbed(auction: Auction, round: RoundState): EmbedBuilder {
    const nominee = auction.slaves.get(round.nomineeId);
    const eligibleMasterIds = getEligibleMasterIdsForRound(auction, round);
    const bidsCount = eligibleMasterIds.filter((masterId) => round.bids.has(masterId)).length;

    return new EmbedBuilder()
        .setColor(colorsMap["green-500"])
        .setAuthor({ name: "🔥 Available Now 🔥" })
        .setTitle(
            `__${nominee?.tag ?? round.nomineeTag ?? round.nomineeId}__ — ${nominee?.specialty.toLowerCase() ?? "unknown"}`,
        )
        .setDescription(
            `\n\nBidding has been opened for <@${round.nomineeId}>!` +
                `\nEnds ${getRelativeDiscordTimestamp(round.deadline)}` +
                `\n\n\n**Priority Order For Resolving Ties**\n${round.priorityOrder.map((masterId) => `<@${masterId}>`).join(" > ")}` +
                `\n\n\n**Bidding Progress** (${bidsCount}/${eligibleMasterIds.length})\n` +
                buildBidProgressString(auction, round),
        )
        .setThumbnail(round.nomineeAvatarURL ?? null)
        .setFooter({ text: "⚠️ Bids are final once submitted ⚠️" });
}

export function createRoundActionRow(auction: Auction, round: RoundState): ActionRowBuilder<ButtonBuilder> {
    const disabled = areAllBidsReceived(auction, round) || round.deadline <= Date.now();
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(auctionCustomIds.openBidOverview.build(auction.id))
            .setLabel(disabled ? "Bidding closed" : "Start bidding")
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
    );
}
