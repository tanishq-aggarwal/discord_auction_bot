import { EmbedBuilder, type Client } from "discord.js";
import type { Auction } from "../../database/auctionStore.js";
import { auctions, persistState } from "../../database/global.js";
import { getNextNominatorId, getNominationType } from "../../domain/nomination.js";
import { sleep } from "../../utils/common.js";
import { colorsMap, replyBuilder } from "../../utils/discord-utils.js";
import { finalizeSealedRound } from "./roundLifecycle.js";
import { areAllBidsReceived, autoSubmitMissingBids } from "./rules.js";
import {
    BID_REVEAL_DELAY_MS,
    buildAllBidsReceivedEmbed,
    buildBiddingRoundEmbed,
    buildNextNominatorEmbed,
    buildRoundRevealEmbed,
    createRoundActionRow,
} from "./messages.js";
import type { SealedRoundState } from "./types.js";
import { isSealedRound } from "./types.js";

const finalizingRounds = new WeakSet<SealedRoundState>();

function isRoundStillActive(auction: Auction, round: SealedRoundState): boolean {
    return auction.currentRoundState === round;
}

export async function editBiddingRoundMessage(
    client: Client,
    auction: Auction,
    round: SealedRoundState,
): Promise<void> {
    if (!isRoundStillActive(auction, round) || !auction.channelId || !round.statusMessageId) return;

    const channel = await client.channels.fetch(auction.channelId);
    if (!isRoundStillActive(auction, round) || !channel?.isTextBased()) return;

    const message = await channel.messages.fetch(round.statusMessageId);
    if (!isRoundStillActive(auction, round)) return;
    await message.edit({
        embeds: [buildBiddingRoundEmbed(auction, round)],
        components: [createRoundActionRow(auction, round)],
    });
}

export async function finalizeRound(
    client: Client,
    auction: Auction,
    round: SealedRoundState,
    autoFillMissingBids: boolean,
): Promise<void> {
    if (!isRoundStillActive(auction, round) || finalizingRounds.has(round)) return;
    finalizingRounds.add(round);

    try {
        if (round.timeoutHandle) {
            clearTimeout(round.timeoutHandle);
            delete round.timeoutHandle;
        }
        if (autoFillMissingBids) autoSubmitMissingBids(auction, round);
        if (!isRoundStillActive(auction, round)) return;
        if (!areAllBidsReceived(auction, round)) {
            throw new Error(`Round ${auction.id}/${round.nomineeId} could not collect all eligible bids.`);
        }

        try {
            await editBiddingRoundMessage(client, auction, round);
        } catch (error) {
            console.warn("[auction:round-finalize:edit-round-message]", error);
        }
        if (!isRoundStillActive(auction, round)) return;

        let channel: Awaited<ReturnType<Client["channels"]["fetch"]>> | null = null;
        if (auction.channelId) {
            try {
                channel = await client.channels.fetch(auction.channelId);
            } catch (error) {
                console.warn("[auction:round-finalize:fetch-channel]", error);
            }
        }
        if (!isRoundStillActive(auction, round)) return;

        if (channel?.isTextBased() && "send" in channel) {
            try {
                await channel.send({ embeds: [buildAllBidsReceivedEmbed(round)] });
            } catch (error) {
                console.warn("[auction:round-finalize:announce-close]", error);
            }
        }
        if (!isRoundStillActive(auction, round)) return;

        await sleep(BID_REVEAL_DELAY_MS);
        if (!isRoundStillActive(auction, round)) return;

        const winner = finalizeSealedRound(auction, round);
        persistState();

        if (!channel?.isTextBased() || !("send" in channel)) return;
        if (!winner) {
            try {
                await channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(colorsMap["blue-400"])
                            .setDescription(`No eligible bids were submitted for <@${round.nomineeId}> this round.`),
                    ],
                });
            } catch (error) {
                console.warn("[auction:round-finalize:no-winner-message]", error);
            }
        } else {
            try {
                await channel.send({
                    embeds: [buildRoundRevealEmbed(auction, round, winner.winnerId, winner.winningBid)],
                    content: `<@${round.nomineeId}>`,
                });
            } catch (error) {
                console.warn("[auction:round-finalize:reveal-message]", error);
            }
        }

        if (auction.status !== "CLOSED" && getNominationType(auction) === "manual") {
            const nextNominatorId = auction.nextNominatorId ?? getNextNominatorId(auction, round.nominatedById);
            if (nextNominatorId) {
                await sleep(3000);
                try {
                    await channel.send({ embeds: [buildNextNominatorEmbed(nextNominatorId)] });
                } catch (error) {
                    console.warn("[auction:round-finalize:next-nominator-message]", error);
                }
            }
        }

        if (auction.status === "CLOSED") {
            const auctionOverMessage = replyBuilder({
                title: "Auction Complete 🏁",
                description:
                    "The auction is now over! All the slaves have been assigned to their respective masters, doomed to work for them till the end of time.",
                color: "blue-400",
            });
            if (auctionOverMessage.embeds) {
                try {
                    await channel.send({ embeds: auctionOverMessage.embeds });
                } catch (error) {
                    console.warn("[auction:round-finalize:auction-over-message]", error);
                }
            }
        }
    } finally {
        finalizingRounds.delete(round);
    }
}

export function scheduleRoundDeadline(client: Client, auction: Auction, round: SealedRoundState): void {
    if (round.timeoutHandle) clearTimeout(round.timeoutHandle);
    const delayMs = Math.max(0, round.deadline - Date.now());
    round.timeoutHandle = setTimeout(() => {
        if (!isRoundStillActive(auction, round)) return;
        void finalizeRound(client, auction, round, true).catch((error) => {
            console.error("[auction:round-finalize-deadline]", error);
        });
    }, delayMs);
}

export function resumePersistedSealedRounds(client: Client): void {
    for (const auction of auctions.listAll()) {
        const round = auction.currentRoundState;
        if (auction.status === "LIVE" && round && isSealedRound(round)) {
            scheduleRoundDeadline(client, auction, round);
        }
    }
}
