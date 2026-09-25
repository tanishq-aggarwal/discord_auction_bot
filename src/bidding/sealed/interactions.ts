import {
    ActionRowBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    type ButtonInteraction,
    type ModalSubmitInteraction,
} from "discord.js";
import type { Auction } from "../../database/auctionStore.js";
import { auctions, persistState } from "../../database/global.js";
import { computeMaxBidAllowed, getRemainingSlots } from "../../domain/economy.js";
import { errorReplyBuilder } from "../../utils/discord-utils.js";
import { sealedCustomIds } from "./customIds.js";
import { editBiddingRoundMessage, finalizeRound } from "./coordinator.js";
import { buildMasterOverviewEmbed, createOverviewActionRow } from "./messages.js";
import { areAllBidsReceived, getMinimumBidForRound } from "./rules.js";
import type { SealedRoundState } from "./types.js";
import { isSealedRound } from "./types.js";

const EPHEMERAL_OVERVIEW_TTL_MS = 15 * 60 * 1000;
const pendingOverviewMessages = new Map<string, { messageId: string; token: string; createdAt: number }>();

function getOverviewMessageKey(auctionId: string, userId: string): string {
    return `${auctionId}:${userId}`;
}

function rememberOverviewMessage(interaction: ButtonInteraction, auctionId: string): void {
    if (!interaction.message.id) return;
    const now = Date.now();
    for (const [key, value] of pendingOverviewMessages.entries()) {
        if (now - value.createdAt > EPHEMERAL_OVERVIEW_TTL_MS) pendingOverviewMessages.delete(key);
    }
    pendingOverviewMessages.set(getOverviewMessageKey(auctionId, interaction.user.id), {
        messageId: interaction.message.id,
        token: interaction.token,
        createdAt: now,
    });
}

function consumeOverviewMessage(auctionId: string, userId: string): { messageId: string; token: string } | null {
    const key = getOverviewMessageKey(auctionId, userId);
    const message = pendingOverviewMessages.get(key);
    if (!message) return null;

    pendingOverviewMessages.delete(key);
    if (Date.now() - message.createdAt > EPHEMERAL_OVERVIEW_TTL_MS) return null;
    return { messageId: message.messageId, token: message.token };
}

async function deleteOverviewMessageAfterBid(interaction: ModalSubmitInteraction, auctionId: string): Promise<void> {
    const message = consumeOverviewMessage(auctionId, interaction.user.id);
    if (!message) return;

    try {
        await interaction.client.rest.delete(
            `/webhooks/${interaction.applicationId}/${message.token}/messages/${message.messageId}`,
        );
    } catch (error) {
        console.warn("[auction:delete-overview-message]", error);
    }
}

function validateBidInteraction(auction: Auction, round: SealedRoundState, masterId: string): string | null {
    if (auction.currentRoundState !== round) return "This round is no longer active.";
    if (round.deadline <= Date.now()) return "The bidding deadline has been reached.";
    if (!auction.masters.has(masterId)) return "You are not a master in this auction.";
    if (round.bids.has(masterId)) return "You already submitted your bid.";

    const slotsLeft = getRemainingSlots(auction, masterId);
    if (slotsLeft <= 0) {
        return `You already reached your slave cap (${auction.rules?.maxSlavesPerMaster ?? 0}).`;
    }

    const maxBidAllowed = computeMaxBidAllowed(auction, masterId);
    const minBidRequired = getMinimumBidForRound(round, masterId);
    if (maxBidAllowed < minBidRequired) {
        return minBidRequired === 0
            ? "You cannot bid this round due to reserve constraints."
            : `You must bid at least ${minBidRequired}🪙 this round, but your max allowed bid is ${maxBidAllowed}🪙.`;
    }
    return null;
}

function requireSealedRound(auction: Auction): SealedRoundState | null {
    const round = auction.currentRoundState;
    if (!round || !isSealedRound(round)) return null;
    return round;
}

export async function handleSealedBidButton(interaction: ButtonInteraction): Promise<boolean> {
    const overviewAuctionId = sealedCustomIds.openBidOverview.parse(interaction.customId);
    const placeBidAuctionId = sealedCustomIds.placeBid.parse(interaction.customId);
    const auctionId = overviewAuctionId ?? placeBidAuctionId;
    if (!auctionId) return false;
    if (!interaction.inGuild() || !interaction.guildId) return false;

    const auction = auctions.getById(auctionId);
    const round = auction ? requireSealedRound(auction) : null;
    if (!auction || auction.guildId !== interaction.guildId || !round) {
        await interaction.reply(errorReplyBuilder({ description: "This round is no longer active." }));
        return false;
    }

    const validationError = validateBidInteraction(auction, round, interaction.user.id);
    if (validationError) {
        await interaction.reply(errorReplyBuilder({ description: validationError }));
        return false;
    }

    if (overviewAuctionId) {
        await interaction.reply({
            embeds: [buildMasterOverviewEmbed(auction, interaction.user.id)],
            components: [createOverviewActionRow(auction.id)],
            flags: MessageFlags.Ephemeral,
        });
        return false;
    }

    rememberOverviewMessage(interaction, auction.id);
    const minBidRequired = getMinimumBidForRound(round, interaction.user.id);
    const maxBidAllowed = computeMaxBidAllowed(auction, interaction.user.id);
    const input = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel(`Enter bid amount (${minBidRequired}-${maxBidAllowed}🪙)`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`${minBidRequired} - ${maxBidAllowed}`)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(4);
    const modal = new ModalBuilder()
        .setCustomId(sealedCustomIds.bidModal.build(auction.id))
        .setTitle("Place your bid")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

    await interaction.showModal(modal);
    return false;
}

export async function handleSealedBidModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const auctionId = sealedCustomIds.bidModal.parse(interaction.customId);
    if (!auctionId || !interaction.inGuild() || !interaction.guildId) return false;

    const auction = auctions.getById(auctionId);
    const round = auction ? requireSealedRound(auction) : null;
    if (!auction || auction.guildId !== interaction.guildId || !round) {
        await interaction.reply(errorReplyBuilder({ description: "This round is no longer active." }));
        return false;
    }

    const validationError = validateBidInteraction(auction, round, interaction.user.id);
    if (validationError) {
        await interaction.reply(errorReplyBuilder({ description: validationError }));
        return false;
    }

    const maxBidAllowed = computeMaxBidAllowed(auction, interaction.user.id);
    const minBidRequired = getMinimumBidForRound(round, interaction.user.id);
    const bidAmount = Number(interaction.fields.getTextInputValue("amount").trim());
    if (!Number.isInteger(bidAmount) || bidAmount < minBidRequired || bidAmount > maxBidAllowed) {
        await interaction.reply(
            errorReplyBuilder({
                description: `Invalid bid. Please enter an amount between ${minBidRequired} and ${maxBidAllowed}.`,
            }),
        );
        return false;
    }

    round.bids.set(interaction.user.id, {
        amount: bidAmount,
        isAuto: false,
        submittedAt: Date.now(),
    });
    persistState();
    await interaction.deferUpdate();
    await deleteOverviewMessageAfterBid(interaction, auction.id);

    if (auction.currentRoundState !== round) return true;
    if (areAllBidsReceived(auction, round)) {
        void finalizeRound(interaction.client, auction, round, false).catch((error) => {
            console.error("[auction:round-finalize-all-bids]", error);
        });
        return true;
    }

    await editBiddingRoundMessage(interaction.client, auction, round);
    return true;
}
