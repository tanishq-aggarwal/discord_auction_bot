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
import { sleep } from "../utils/common.js";
import { colorsMap, errorReplyBuilder, getRelativeDiscordTimestamp } from "../utils/discord-utils.js";

const OPEN_BID_OVERVIEW_PREFIX = "auction:open-bid-overview";
const PLACE_BID_PREFIX = "auction:place-bid";
const BID_MODAL_PREFIX = "auction:submit-bid";
const BID_REVEAL_DELAY_MS = 15_000;

type ActiveRoundState = NonNullable<Auction["currentRoundState"]>;
const finalizingRounds = new WeakSet<ActiveRoundState>();

function openBidOverviewButtonCustomId(auctionId: string): string {
    return `${OPEN_BID_OVERVIEW_PREFIX}:${auctionId}`;
}

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
    const maxSlaves = auction.rules!.maxSlavesPerMaster;
    const purchasedCount = auction.state!.purchases.get(masterId)!.length;
    return maxSlaves - purchasedCount;
}

function computeMaxBidAllowed(auction: Auction, masterId: string): number {
    const balance = auction.state!.balances.get(masterId)!;
    if (balance <= 0) return 0;

    const remainingSlots = getRemainingSlots(auction, masterId);
    if (remainingSlots <= 0) return 0;

    const reserve = Math.max(0, remainingSlots - 1);
    return Math.max(0, balance - reserve);
}

function buildMasterOverviewEmbed(auction: Auction, masterId: string): EmbedBuilder {
    const balance = auction.state!.balances.get(masterId)!;
    const remainingSlots = getRemainingSlots(auction, masterId);
    const maxSlaves = auction.rules!.maxSlavesPerMaster;
    const purchasedSlaveIds = auction.state!.purchases.get(masterId) ?? [];
    const purchasesSoFar = purchasedSlaveIds.length
        ? purchasedSlaveIds
            .map(slaveId => {
                const slave = auction.slaves.get(slaveId)!;
                return `- <@${slaveId}> (${slave.specialty.toLowerCase()})`;
            })
            .join("\n")
        : "_- No purchases made yet_";

    const embed = new EmbedBuilder()
        .setColor(colorsMap['yellow-400'])
        .setTitle("📋 Your Auction Summary")
        .setDescription(
            `**Your Team So Far:**\n${purchasesSoFar}\n\n` + 
            `**Current Balance:** ${balance}🪙\n` + 
            `**Remaining Purchases:** ${remainingSlots}/${maxSlaves}\n` 
        );
    if (remainingSlots > 0) {
        embed.setFooter({ text: `⚠️ You must keep at least ${balance - computeMaxBidAllowed(auction, masterId)}🪙 reserved for future purchases.`});
    }
    return embed;
}

function createOverviewActionRow(auctionId: string): ActionRowBuilder<ButtonBuilder> {
    const placeBidButton = new ButtonBuilder()
        .setCustomId(placeBidButtonCustomId(auctionId))
        .setLabel("Place bid")
        .setStyle(ButtonStyle.Success);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(placeBidButton);
}

function getOwnerId(auction: Auction, slaveId: string): string | null {
    for (const [masterId, slaveIds] of auction.state!.purchases.entries()) {
        if (slaveIds.includes(slaveId)) return masterId;
    }
    return null;
}

function rotatePriorityOrder(priorityOrder: Master["id"][]): Master["id"][] {
    return priorityOrder.slice(1).concat(priorityOrder.slice(0, 1));
}

function areAllBidsReceived(auction: Auction): boolean {
    return auction.currentRoundState!.bids.size >= auction.masters.size;
}

function isRoundStillActive(auction: Auction, round: ActiveRoundState): boolean {
    return auction.currentRoundState === round;
}

function autoSubmitMissingBids(auction: Auction, round: ActiveRoundState) {
    for (const masterId of auction.masters.keys()) {
        if (round.bids.has(masterId)) continue;
        round.bids.set(masterId, {
            amount: 1,
            isAuto: true,
            submittedAt: Date.now(),
        });
    }
}

function getRoundWinner(auction: Auction, round: ActiveRoundState): { winnerId: string; winningBid: number } {
    const bids = Array.from(round.bids.entries());
    const highestBid = Math.max(...bids.map(([, bid]) => bid.amount));
    const tiedMasterIds = bids
        .filter(([, bid]) => bid.amount === highestBid)
        .map(([masterId]) => masterId);

    const winnerId =
        round.priorityOrder.find(masterId => tiedMasterIds.includes(masterId))
        ?? tiedMasterIds[0]
        ?? Array.from(auction.masters.keys())[0]!;

    return { winnerId, winningBid: highestBid };
}

function isAuctionSoldOut(auction: Auction): boolean {
    let soldCount = 0;
    for (const slaveIds of auction.state!.purchases.values()) {
        soldCount += slaveIds.length;
    }
    return soldCount >= auction.slaves.size;
}

function buildAllBidsReceivedEmbed(round: ActiveRoundState): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(colorsMap['blue-400'])
        .setDescription(`⌛ Bidding closed for <@${round.nomineeId}>! Revealing the results ${getRelativeDiscordTimestamp(Date.now() + BID_REVEAL_DELAY_MS)}... 🥁`);
}

function buildRoundRevealEmbed(auction: Auction, round: ActiveRoundState, winnerId: string, winningBid: number): EmbedBuilder {
    const nominee = auction.slaves.get(round.nomineeId);
    const bidsList = Array.from(auction.masters.keys())
        .map(masterId => {
            const bid = round.bids.get(masterId)!;
            return `- <@${masterId}> — **${bid.amount}**🪙${bid.isAuto ? " (auto)" : ""}`;
        })
        .join("\n");

    return new EmbedBuilder()
        .setColor(colorsMap['violet-500'])
        // .setAuthor({ name: "🔔 Bid reveal 🔔" })
        .setTitle(`🔔 Results for ${nominee?.tag ?? `<@${round.nomineeId}>`} 🔔`)
        .setDescription(
            `\nThe bids are in for <@${round.nomineeId}>!\n` +
            `${bidsList}\n\n` +
            `**🔨 Going once... going twice... SOLD to <@${winnerId}> for ${winningBid}🪙!**`
        )
        .setThumbnail(round.nomineeAvatarURL ?? null);
}

async function finalizeRound({
    client,
    auction,
    round,
    autoFillMissingBids,
}: {
    client: Client,
    auction: Auction,
    round: ActiveRoundState,
    autoFillMissingBids: boolean,
}): Promise<void> {
    if (!isRoundStillActive(auction, round)) return;
    if (finalizingRounds.has(round)) return;
    finalizingRounds.add(round);

    try {
        if (round.timeoutHandle) {
            clearTimeout(round.timeoutHandle);
            delete round.timeoutHandle;
        }

        if (autoFillMissingBids) {
            autoSubmitMissingBids(auction, round);
        }

        if (!isRoundStillActive(auction, round)) return;
        if (!areAllBidsReceived(auction)) return;

        await editBiddingRoundMessage(client, auction);

        let channel: Awaited<ReturnType<Client["channels"]["fetch"]>> | null = null;
        if (auction.channelId) {
            channel = await client.channels.fetch(auction.channelId);
        }
        if (channel?.isTextBased() && "send" in channel) {
            await channel.send({ embeds: [buildAllBidsReceivedEmbed(round)] });
        }

        await sleep(BID_REVEAL_DELAY_MS);
        if (!isRoundStillActive(auction, round)) return;

        const { winnerId, winningBid } = getRoundWinner(auction, round);
        const winnerBalance = auction.state!.balances.get(winnerId) ?? 0;
        auction.state!.balances.set(winnerId, Math.max(0, winnerBalance - winningBid));
        auction.state!.purchases.get(winnerId)!.push(round.nomineeId);

        auction.lastRoundState = round;
        delete auction.currentRoundState;

        if (isAuctionSoldOut(auction)) {
            auction.status = "CLOSED";
            auction.state!.endedAt = Date.now();
        }

        if (channel?.isTextBased() && "send" in channel) {
            await channel.send({ embeds: [buildRoundRevealEmbed(auction, round, winnerId, winningBid)] });
        }


        // TODO: Reveal auction state to all masters
    }
    finally {
        finalizingRounds.delete(round);
    }
}

function scheduleRoundDeadline(client: Client, auction: Auction, round: ActiveRoundState) {
    const delayMs = Math.max(0, round.deadline - Date.now());
    round.timeoutHandle = setTimeout(() => {
        if (auction.currentRoundState !== round) return;
        void finalizeRound({
            client,
            auction,
            round,
            autoFillMissingBids: true,
        }).catch(error => {
            console.error("[auction:round-finalize-deadline]", error);
        });
    }, delayMs);
}

function validateBidInteraction(auction: Auction, masterId: string): string | null {
    if (!auction.currentRoundState) return "This round is no longer active.";
    if (auction.currentRoundState.deadline <= Date.now()) return "The bidding deadline has been reached.";
    if (!auction.masters.has(masterId)) return "You are not a master in this auction.";
    if (auction.currentRoundState.bids.has(masterId)) return "You already submitted your bid.";

    const slotsLeft = getRemainingSlots(auction, masterId);
    if (slotsLeft <= 0) {
        return `You already reached your slave cap (${auction.rules!.maxSlavesPerMaster}).`;
    }

    const balance = auction.state!.balances.get(masterId)!;
    if (balance <= 0) return "You have no coins left.";

    const maxBidAllowed = computeMaxBidAllowed(auction, masterId);
    if (maxBidAllowed < 1) {
        return "You cannot bid this round due to reserve constraints.";
    }

    return null;
}


async function editBiddingRoundMessage(client: Client, auction: Auction) {
    const round = auction.currentRoundState;
    if (!round || !auction.channelId || !round.statusMessageId) return;

    const channel = await client.channels.fetch(auction.channelId);
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(round.statusMessageId);
    await message.edit({
        embeds: [buildBiddingRoundEmbed(auction)],
        components: [createRoundActionRow(auction)],
    });
}


function buildBidProgressString(auction: Auction): string {
    const bids = auction.currentRoundState!.bids;

    return Array.from(auction.masters.keys())
        .map(masterId => {
            const bid = bids.get(masterId);
            return bid
                ? bid.isAuto
                    ? `- <@${masterId}> — \`⏳ auto-submitted\``
                    : `- <@${masterId}> — \`✅ received\``
                : `- <@${masterId}> — \`❌ pending\``;
        })
        .join("\n");
}

function buildBiddingRoundEmbed(auction: Auction) {
    const round = auction.currentRoundState!;
    const nominee = auction.slaves.get(round.nomineeId)!;
    const bidProgress = buildBidProgressString(auction);
    const bidsCount = auction.currentRoundState?.bids.size ?? 0;

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

function createRoundActionRow(auction: Auction): ActionRowBuilder<ButtonBuilder> {
    const allBidsReceived = areAllBidsReceived(auction);
    const disabled = allBidsReceived || auction.currentRoundState!.deadline <= Date.now();

    const button = new ButtonBuilder()
        .setCustomId(openBidOverviewButtonCustomId(auction.id))
        .setLabel(disabled ? "Bidding closed" : "Start bidding")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
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

    const ownedByMaster = getOwnerId(auction, nominatedSlave.id);
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
        embeds: [buildBiddingRoundEmbed(auction)],
        components: [createRoundActionRow(auction)],
    });
    const roundMessageId = (await response.fetch()).id;
    auction.currentRoundState.statusMessageId = roundMessageId;
    scheduleRoundDeadline(interaction.client, auction, auction.currentRoundState);
}



export async function handlePlaceBidButton(interaction: ButtonInteraction) {
    const overviewAuctionId = parseCustomId(interaction.customId, OPEN_BID_OVERVIEW_PREFIX);
    const placeBidAuctionId = parseCustomId(interaction.customId, PLACE_BID_PREFIX);
    const auctionId = overviewAuctionId ?? placeBidAuctionId;
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

    if (overviewAuctionId) {
        await interaction.reply({
            embeds: [buildMasterOverviewEmbed(auction, interaction.user.id)],
            components: [createOverviewActionRow(auction.id)],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const maxBidAllowed = computeMaxBidAllowed(auction, interaction.user.id);
    const modal = new ModalBuilder()
        .setCustomId(bidModalCustomId(auction.id))
        .setTitle(`Place your bid`);

    const input = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel(`Enter bid amount (max ${maxBidAllowed}🪙)`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`1 - ${maxBidAllowed}`)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(3);

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

    // await interaction.reply({
    //     content: `Bid submitted: **${bidAmount}** coins.`,
    //     flags: MessageFlags.Ephemeral,
    // });

    const round = auction.currentRoundState;
    if (areAllBidsReceived(auction)) {
        void finalizeRound({
            client: interaction.client,
            auction,
            round,
            autoFillMissingBids: false,
        }).catch(error => {
            console.error("[auction:round-finalize-all-bids]", error);
        });
        return true;
    }

    await editBiddingRoundMessage(interaction.client, auction);
    return true;
}