import type { ChatInputCommandInteraction, InteractionReplyOptions } from "discord.js";
import type { Auction } from "../../database/auctionStore.js";
import { persistState } from "../../database/global.js";
import { errorReplyBuilder } from "../../utils/discord-utils.js";
import { scheduleRoundDeadline } from "./coordinator.js";
import { buildBiddingRoundEmbed, createRoundActionRow } from "./messages.js";
import { beginSealedRound, clearSealedRound, type BeginRoundInput } from "./roundLifecycle.js";
import { canMasterBeObligatedNominator } from "./rules.js";
import { getNominationType } from "../../domain/nomination.js";

export const MIN_ROUND_DURATION_SECONDS = 10;
export const MAX_ROUND_DURATION_SECONDS = 300;

export function readOptionalRoundDurationMs(
    interaction: ChatInputCommandInteraction,
): { durationMs?: number; error?: undefined } | { durationMs?: undefined; error: string } {
    const roundDurationSeconds = interaction.options.getInteger("round_duration", false);
    if (roundDurationSeconds === null) return {};
    if (
        !Number.isInteger(roundDurationSeconds) ||
        roundDurationSeconds < MIN_ROUND_DURATION_SECONDS ||
        roundDurationSeconds > MAX_ROUND_DURATION_SECONDS
    ) {
        return {
            error: `Round duration must be between **${MIN_ROUND_DURATION_SECONDS}** and **${MAX_ROUND_DURATION_SECONDS}** seconds.`,
        };
    }
    return { durationMs: roundDurationSeconds * 1000 };
}

export function describeObligatedMasterError(auction: Auction, masterId: string): string | null {
    if (!auction.masters.has(masterId)) {
        return `<@${masterId}> is not a master in this auction. Please select a valid nominator.`;
    }
    if (!canMasterBeObligatedNominator(auction, masterId)) {
        return getNominationType(auction) === "random"
            ? `<@${masterId}> cannot be obligated this round. They need remaining purchase slots and enough budget to bid at least 1🪙.`
            : `<@${masterId}> already reached the maximum number of purchases or cannot bid the required 1🪙. Choose another nominator.`;
    }
    return null;
}

async function respondToCommand(
    interaction: ChatInputCommandInteraction,
    payload: InteractionReplyOptions,
): Promise<void> {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
            content: payload.content ?? null,
            embeds: payload.embeds ?? [],
            components: payload.components ?? [],
        });
        return;
    }
    await interaction.reply(payload);
}

export async function launchSealedRound(
    interaction: ChatInputCommandInteraction,
    auction: Auction,
    input: BeginRoundInput,
): Promise<void> {
    let round;
    try {
        round = beginSealedRound(auction, input);
    } catch (error) {
        const description =
            error instanceof Error && error.message === "A round is already active."
                ? "A round is already in progress. Please wait for it to finish before starting a new round."
                : error instanceof Error
                  ? error.message
                  : "Could not start the round.";
        await respondToCommand(interaction, errorReplyBuilder({ description }));
        return;
    }

    persistState();

    try {
        await respondToCommand(interaction, {
            embeds: [buildBiddingRoundEmbed(auction, round)],
            components: [createRoundActionRow(auction, round)],
        });
    } catch (error) {
        if (auction.currentRoundState === round) {
            clearSealedRound(auction);
            persistState();
        }
        throw error;
    }

    if (auction.currentRoundState !== round) return;
    scheduleRoundDeadline(interaction.client, auction, round);
    try {
        round.statusMessageId = (await interaction.fetchReply()).id;
        persistState();
    } catch (error) {
        console.warn("[auction:start-round:fetch-status-message]", error);
    }
}
