import type { ChatInputCommandInteraction } from "discord.js";
import type { Auction } from "../database/auctionStore.js";
import { auctions, persistState } from "../database/global.js";
import { initializeAuction } from "../domain/auctionLifecycle.js";
import { getNextNominatorId } from "../domain/roundRules.js";
import { DEFAULT_ROUND_DURATION_SECONDS, secondsToMs, sleep } from "../utils/common.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";

function resolveMasterIdFromPriorityToken(auction: Auction, rawToken: string): string | null {
    const token = rawToken.trim();
    if (!token) return null;

    const mentionMatch = token.match(/^<@!?(\d+)>$/);
    const normalizedId = mentionMatch?.[1] ?? token;
    if (auction.masters.has(normalizedId)) return normalizedId;

    const normalizedTag = token.toLowerCase();
    return (
        Array.from(auction.masters.values()).find((master) => master.tag.toLowerCase() === normalizedTag)?.id ?? null
    );
}

async function sendAuctionIntroduction(
    interaction: ChatInputCommandInteraction,
    auction: Auction,
    startingPriorityOrder: string[],
): Promise<void> {
    try {
        await sleep(3000);
        await interaction.followUp(
            replyBuilder({
                title: "Rules of the auction",
                description:
                    `- Each master will start with **${auction.rules?.startingBudget}🪙**` +
                    `\n- Each master can acquire a maximum of **${auction.rules?.maxSlavesPerMaster}** slaves.` +
                    (auction.rules?.nominationType === "random"
                        ? "\n- Each remaining slave is nominated at random on behalf of the next master in starting order. Finished masters are skipped. The obligated master must bid at least 1🪙. Use `/auction start-next-random-round` for each round."
                        : "\n- Masters nominate in the starting order. Finished masters are skipped. The nominating master must bid at least 1🪙. Use `/auction start-next-round` for each round.") +
                    "\n- Masters must hold **at least** 1🪙 for each slave they are yet to acquire." +
                    `\n- Each round lasts **${Math.round((auction.rules?.roundDurationMs ?? 0) / 1000)}** seconds by default. Missing bids are submitted automatically at the minimum amount.` +
                    `\n- ${auction.rules?.priorityType === "fixed" ? "Ties are resolved using the configured ranking." : "Tie-breaking priority rotates after each completed round."}` +
                    "\n- The auction ends once all slaves have been sold.",
                footer: "Use the `/auction view-status` command at any time to check the current status.",
                color: "violet-500",
            }),
        );

        await sleep(5000);
        await interaction.followUp(
            replyBuilder({
                title: "Meet the masters",
                description:
                    `The following masters will be bidding${auction.rules?.priorityType === "fixed" ? " (in ranked order)" : ""}:\n` +
                    startingPriorityOrder.map((masterId, index) => `${index + 1}. <@${masterId}>`).join("\n"),
                color: "violet-500",
            }),
        );

        await sleep(5000);
        await interaction.followUp(
            replyBuilder({
                title: "Meet the slaves",
                description:
                    "The following slaves will be up for grabs:\n" +
                    Array.from(auction.slaves.values())
                        .map((slave, index) => `${index + 1}. <@${slave.id}> (${slave.specialty.toLowerCase()})`)
                        .join("\n"),
                color: "violet-500",
            }),
        );

        const firstNominatorId = auction.rules?.nominationType === "manual" ? getNextNominatorId(auction) : null;
        if (firstNominatorId) {
            await sleep(5000);
            await interaction.followUp(
                replyBuilder({
                    description: `The first slave will be nominated by <@${firstNominatorId}>.`,
                    color: "blue-400",
                }),
            );
        }
    } catch (error) {
        console.warn("[auction:start:introduction]", error);
    }
}

export async function startAuction(interaction: ChatInputCommandInteraction): Promise<void> {
    const auctionName = interaction.options.getString("auction_name", true);
    const priorityOrder = interaction.options.getString("priority_order", true);
    const priorityType = interaction.options.getString("priority_type", false) ?? "fixed";
    const nominationType = interaction.options.getString("nomination_type", false) ?? "manual";
    const startingBudget = interaction.options.getInteger("starting_budget", true);

    if (startingBudget < 1 || startingBudget > 1000) {
        await interaction.reply(
            errorReplyBuilder({ description: "Starting budget must be between **1** and **1000**." }),
        );
        return;
    }
    if (nominationType !== "manual" && nominationType !== "random") {
        await interaction.reply(
            errorReplyBuilder({ description: "Nomination type must be **manual** or **random**." }),
        );
        return;
    }
    if (priorityType !== "fixed" && priorityType !== "rotating") {
        await interaction.reply(errorReplyBuilder({ description: "Priority type must be **fixed** or **rotating**." }));
        return;
    }

    const auction = auctions.getByName(interaction.guildId!, auctionName);
    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** not found.` }));
        return;
    }
    if (auction.status === "LIVE") {
        await interaction.reply(
            errorReplyBuilder({ description: `Auction **${auctionName}** is already in progress.` }),
        );
        return;
    }
    if (auction.status === "CLOSED") {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** is already over.` }));
        return;
    }
    if (auction.masters.size < 1 || auction.slaves.size < 1) {
        await interaction.reply(
            errorReplyBuilder({
                description:
                    auction.masters.size < 1
                        ? "At least 1 master must be added before starting an auction."
                        : "At least 1 slave must be added before starting an auction.",
            }),
        );
        return;
    }

    const priorityTokens = priorityOrder
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);
    if (priorityTokens.length !== auction.masters.size) {
        await interaction.reply(
            errorReplyBuilder({
                description: "Number of masters in priority order must match the number of masters in the auction.",
            }),
        );
        return;
    }

    const startingPriorityOrder: string[] = [];
    const seenMasterIds = new Set<string>();
    for (const token of priorityTokens) {
        const masterId = resolveMasterIdFromPriorityToken(auction, token);
        if (!masterId) {
            await interaction.reply(
                errorReplyBuilder({ description: `Master **${token}** is not part of **${auction.name}**.` }),
            );
            return;
        }
        if (seenMasterIds.has(masterId)) {
            await interaction.reply(
                errorReplyBuilder({ description: `Master **${token}** appears more than once in priority order.` }),
            );
            return;
        }
        seenMasterIds.add(masterId);
        startingPriorityOrder.push(masterId);
    }

    initializeAuction(auction, {
        channelId: interaction.channelId!,
        startingBudget,
        roundDurationMs: secondsToMs(DEFAULT_ROUND_DURATION_SECONDS),
        maxSlavesPerMaster: Math.ceil(auction.slaves.size / auction.masters.size),
        priorityType,
        nominationType,
        startingPriorityOrder,
    });
    persistState();
    console.log(`[auction:start] auction=${auction.name} rules=${JSON.stringify(auction.rules)}`);
    await interaction.reply({
        ...replyBuilder({
            plaintextMessage: startingPriorityOrder.map((masterId) => `<@${masterId}>`).join(" "),
            description: `Auction **${auction.name}** will begin shortly! Meanwhile...`,
        }),
        allowedMentions: { users: startingPriorityOrder },
    });
    void sendAuctionIntroduction(interaction, auction, startingPriorityOrder);
}
