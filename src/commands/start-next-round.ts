import { randomUUID } from "node:crypto";
import {
    type Client,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle,
    type ChatInputCommandInteraction,
} from "discord.js";
import type { Auction, Master } from "../database/auctionStore.js";
import { auctions } from "../database/global.js";
import { colorsMap, errorReplyBuilder, getRelativeDiscordTimestamp } from "../utils/discord-utils.js";

const PLACE_BID_PREFIX = "auction:place-bid";
const BID_MODAL_PREFIX = "auction:submit-bid";

function placeBidButtonCustomId(auctionId: string): string {
    return `${PLACE_BID_PREFIX}:${auctionId}`;
}

function bidModalCustomId(auctionId: string): string {
    return `${BID_MODAL_PREFIX}:${auctionId}`;
}

function parseCustomId(customId: string, expectedPrefix: string): string | null {
    const prefixWithSeparator = `${expectedPrefix}:`;
    if (!customId.startsWith(prefixWithSeparator)) return null;
    const auctionId = customId.slice(prefixWithSeparator.length).trim();
    return auctionId || null;
}

function getRemainingSlots(auction: Auction, masterId: string): number {
    const maxSlaves = auction.rules?.maxSlavesPerMaster ?? 0;
    const purchasedCount = auction.state?.purchases.get(masterId)?.length ?? 0;
    return maxSlaves - purchasedCount;
}

function isLastRoundOverall(auction: Auction): boolean {
    const round = auction.currentRoundState;
    if (!round) return false;

    const sold = new Set<string>();
    for (const slaveIds of auction.state?.purchases.values() ?? []) {
        for (const slaveId of slaveIds) sold.add(slaveId);
    }

    const remainingAfterCurrent = Array.from(auction.slaves.keys()).filter(
        slaveId => !sold.has(slaveId) && slaveId !== round.nomineeId,
    );
    return remainingAfterCurrent.length === 0;
}

function computeMaxBidAllowed(auction: Auction, masterId: string): number {
    const balance = auction.state?.balances.get(masterId) ?? 0;
    const remainingSlots = getRemainingSlots(auction, masterId);
    if (remainingSlots <= 0) return 0;
    if (balance <= 0) return 0;
    if (isLastRoundOverall(auction)) return balance;
    const reserve = Math.max(0, remainingSlots - 1);
    return Math.max(0, balance - reserve);
}

function getMasterId(auction: Auction, slaveId: string): string | null {
    for (const [masterId, slaveIds] of auction.state?.purchases.entries() ?? []) {
        if (slaveIds.includes(slaveId)) return masterId;
    }
    return null;
}

function buildBidProgressLines(auction: Auction): string {
    const bids = auction.currentRoundState?.bids;
    if (!bids) return "No round in progress.";
    return Array.from(auction.masters.keys())
        .map(masterId => {
            const bid = bids.get(masterId);
            return bid
                ? bid.isAuto
                    ? `- <@${masterId}> - \`✅ auto\``
                    : `- <@${masterId}> - \`✅ submitted (${bid.amount})\``
                : `- <@${masterId}> - \`❌ pending\``;
        })
        .join("\n");
}

function createRoundEmbed(auction: Auction) {
    const round = auction.currentRoundState!;
    const bidProgress = buildBidProgressLines(auction);
    const bidsCount = auction.currentRoundState?.bids.size ?? 0;
    const nominee = auction.slaves.get(round.nomineeId)!;

    return new EmbedBuilder()
        .setColor(colorsMap['green-500'])
        .setAuthor({name: `🔥 Available Now 🔥`})
        .setTitle(`__${nominee.tag}__ — ${nominee.specialty.toLowerCase()}`)
        // .setTitle(nominee.tag)
        .setDescription(
                // `(${nominee.specialties ?? "None"})\n\n` +
                `\n\nBidding has been opened for <@${nominee.id}>!\n` +
                `Ends ${getRelativeDiscordTimestamp(round.deadline)}\n\n\n` +
                `**Bidding Progress** (${bidsCount}/${auction.masters.size})\n` +
                bidProgress
        )
        .setThumbnail(round.nomineeAvatarURL ?? null)
        .setFooter({ text: "⚠️ Bids are final once submitted ⚠️" });
}

function rotatePriorityOrder(priorityOrder: Master["id"][]): Master["id"][] {
    return priorityOrder.slice(1).concat(priorityOrder.slice(0, 1));
}

function createRoundActionRow(auction: Auction): ActionRowBuilder<ButtonBuilder> {
    const allBidsReceived = auction.currentRoundState!.bids.size >= auction.masters.size;
    const button = new ButtonBuilder()
        .setCustomId(placeBidButtonCustomId(auction.id))
        .setLabel(allBidsReceived ? "All bids received" : "Place bid")
        .setStyle(ButtonStyle.Success)
        .setDisabled(allBidsReceived);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

async function updateRoundStatusMessage(client: Client, auction: Auction) {
    const round = auction.currentRoundState;
    if (!round || !auction.channelId || !round.statusMessageId) return;

    const channel = await client.channels.fetch(auction.channelId);
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(round.statusMessageId);
    await message.edit({
        embeds: [createRoundEmbed(auction)],
        components: [createRoundActionRow(auction)],
    });
}

function validateBidInteraction(auction: Auction, masterId: string): string | null {
    if (!auction.currentRoundState) return "This round is no longer active.";
    if (!auction.masters.has(masterId)) return "You are not a master in this auction.";
    if (auction.currentRoundState.bids.has(masterId)) return "You already submitted your bid.";

    const slotsLeft = getRemainingSlots(auction, masterId);
    if (slotsLeft <= 0) {
        return `You already reached your slave cap (${auction.rules?.maxSlavesPerMaster ?? 0}).`;
    }

    const balance = auction.state?.balances.get(masterId) ?? 0;
    if (balance <= 0) return "You have no coins left.";

    const maxBidAllowed = computeMaxBidAllowed(auction, masterId);
    if (maxBidAllowed < 1) {
        return "You cannot bid this round due to reserve constraints.";
    }

    return null;
}



export async function startNextRound(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);
    const nominatedSlave = interaction.options.getUser("nominated_slave", true);

    const auction = auctions.getByName(interaction.guildId!, auctionName);
    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** not found.` }));
        return;
    }
    if (auction.status === "INIT") {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** has not begun yet. Please run the \`/auction start\` command to start it.` }));
        return;
    }
    if (auction.status === "CLOSED") {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** is already over.` }));
        return;
    }
    if (!auction.rules || !auction.state || !auction.channelId) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** is missing runtime state. Try resetting and starting it again.` }));
        return;
    }

    if (!auction.slaves.has(nominatedSlave.id)) {
        await interaction.reply(errorReplyBuilder({ description: `<@${nominatedSlave.id}> is not a slave in this auction. Please select a valid slave.` }));
        return;
    }

    const ownedByMaster = getMasterId(auction, nominatedSlave.id);
    if (ownedByMaster) {
        await interaction.reply(errorReplyBuilder({ description: `<@${nominatedSlave.id}> is already owned by <@${ownedByMaster}>. Please select a different slave.` }));
        return;
    }

    if (auction.currentRoundState) {
        await interaction.reply(errorReplyBuilder({ description: "A round is already in progress. Please wait for it to finish before starting a new round." }));
        return;
    }

    if (interaction.channelId !== auction.channelId) {
        await interaction.reply(errorReplyBuilder({ description: `Please run this command in the auction channel <#${auction.channelId}>.` }));
        return;
    }

    const now = Date.now();
    auction.currentRoundState = {
        nomineeId: nominatedSlave.id,
        nomineeTag: nominatedSlave.tag,
        nomineeAvatarURL: nominatedSlave.displayAvatarURL(),
        startedAt: now,
        deadline: now + auction.rules.roundDurationMs,
        priorityOrder: auction.rules.priorityType === 'fixed'
                        ? auction.rules.startingPriorityOrder
                        : auction.lastRoundState
                            ? rotatePriorityOrder(auction.lastRoundState.priorityOrder)
                            : auction.rules.startingPriorityOrder,
        bids: new Map(),
    };

    const response = await interaction.reply({
        embeds: [createRoundEmbed(auction)],
        components: [createRoundActionRow(auction)],
    });
    const roundMessageId = (await response.fetch()).id;
    auction.currentRoundState.statusMessageId = roundMessageId;
}



export async function handlePlaceBidButton(interaction: ButtonInteraction) {
    const auctionId = parseCustomId(interaction.customId, PLACE_BID_PREFIX);
    if (!auctionId) return false;
    if (!interaction.inGuild() || !interaction.guildId) return true;

    const auction = auctions.getById(auctionId);
    if (!auction || auction.guildId !== interaction.guildId || !auction.currentRoundState) {
        await interaction.reply({ content: "This round is no longer active.", flags: MessageFlags.Ephemeral });
        return true;
    }

    const validationError = validateBidInteraction(auction, interaction.user.id);
    if (validationError) {
        await interaction.reply({ content: validationError, flags: MessageFlags.Ephemeral });
        return true;
    }

    const maxBidAllowed = computeMaxBidAllowed(auction, interaction.user.id);
    const modal = new ModalBuilder()
        .setCustomId(bidModalCustomId(auction.id))
        .setTitle(`Place your bid (max ${maxBidAllowed})`);

    const input = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Bid amount")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`1 - ${maxBidAllowed}`)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(6);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    modal.addComponents(row);
    await interaction.showModal(modal);
    return true;
}

export async function handlePlaceBidModal(interaction: ModalSubmitInteraction) {
    const auctionId = parseCustomId(interaction.customId, BID_MODAL_PREFIX);
    if (!auctionId) return false;
    if (!interaction.inGuild() || !interaction.guildId) return true;

    const auction = auctions.getById(auctionId);
    if (!auction || auction.guildId !== interaction.guildId || !auction.currentRoundState) {
        await interaction.reply({ content: "This round is no longer active.", flags: MessageFlags.Ephemeral });
        return true;
    }

    const validationError = validateBidInteraction(auction, interaction.user.id);
    if (validationError) {
        await interaction.reply({ content: validationError, flags: MessageFlags.Ephemeral });
        return true;
    }

    const maxBidAllowed = computeMaxBidAllowed(auction, interaction.user.id);
    const rawBid = interaction.fields.getTextInputValue("amount").trim();
    const bidAmount = Number(rawBid);

    if (!Number.isInteger(bidAmount) || bidAmount < 1 || bidAmount > maxBidAllowed) {
        await interaction.reply({
            content: `Invalid bid. Enter an integer between 1 and ${maxBidAllowed}.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    auction.currentRoundState.bids.set(interaction.user.id, {
        amount: bidAmount,
        isAuto: false,
        submittedAt: Date.now(),
    });

    await updateRoundStatusMessage(interaction.client, auction);
    await interaction.reply({
        content: `Bid submitted: **${bidAmount}** coins.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}