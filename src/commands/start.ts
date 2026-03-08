import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";
import { minsToMs, sleep } from "../utils/common.js";

function resolveMasterIdFromPriorityToken(auction: NonNullable<ReturnType<typeof auctions.getByName>>, rawToken: string): string | null {
    const token = rawToken.trim();
    if (!token) return null;

    const mentionMatch = token.match(/^<@!?(\d+)>$/);
    const normalizedId = mentionMatch?.[1] ?? token;
    if (auction.masters.has(normalizedId)) {
        return normalizedId;
    }

    const normalizedTag = token.toLowerCase();
    const matchingMaster = Array.from(auction.masters.values()).find(master => master.tag.toLowerCase() === normalizedTag);
    return matchingMaster?.id ?? null;
}



export async function startAuction(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);
    const priorityOrder = interaction.options.getString('priority_order', true);
    const priorityType = interaction.options.getString('priority_type', false) ?? 'fixed';
    const startingBudget = interaction.options.getInteger('starting_budget', true);

    if (startingBudget < 1 || startingBudget > 1000) {
        await interaction.reply(errorReplyBuilder({
            description: `Starting budget must be between **1** and **1000**.`,
        }));
        return;
    }
    
    const auction = auctions.getByName(interaction.guildId!, auctionName);
    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction "${auctionName}" not found.` }));
        return;
    }

    if (auction.status === 'LIVE') {
        await interaction.reply(errorReplyBuilder({ description: `Auction "${auctionName}" is already in progress.` }));
        return;
    }

    if (auction.status === 'CLOSED') {
        await interaction.reply(errorReplyBuilder({ description: `Auction "${auctionName}" is already over.` }));
        return;
    }
    
    if (auction.masters.size < 1) {
        await interaction.reply(errorReplyBuilder({ description: 'At least 1 master must be added before starting an auction.' }));
        return;
    }

    if (auction.slaves.size < 1) {
        await interaction.reply(errorReplyBuilder({ description: 'At least 1 slave must be added before starting an auction.' }));
        return;
    }
    
    const priorityTokens = priorityOrder
        .split(',')
        .map(token => token.trim())
        .filter(Boolean);

    if (priorityTokens.length !== auction.masters.size) {
        await interaction.reply(errorReplyBuilder({ description: 'Number of masters in priority order must match the number of masters added to the auction.' }));
        return;
    }

    const startingPriorityOrder: string[] = [];
    const seenMasterIds = new Set<string>();
    for (const token of priorityTokens) {
        const masterId = resolveMasterIdFromPriorityToken(auction, token);
        if (!masterId) {
            await interaction.reply(errorReplyBuilder({ description: `Master "${token}" is not a part of **${auction.name}** auction.` }));
            return;
        }

        if (seenMasterIds.has(masterId)) {
            await interaction.reply(errorReplyBuilder({ description: `Master "${token}" appears more than once in priority order.` }));
            return;
        }

        seenMasterIds.add(masterId);
        startingPriorityOrder.push(masterId);
    }
    
    // Auction channel will be where the /start command was invoked
    auction.channelId = interaction.channelId!;
    auction.status = 'LIVE';
    auction.rules = {
        startingBudget,
        roundDurationMs: minsToMs(2),
        maxSlavesPerMaster: Math.ceil(auction.slaves.size / auction.masters.size),
        priorityType: priorityType as 'fixed' | 'rotating',
        startingPriorityOrder,
    };
    auction.state = {
        startedAt: Date.now(),
        balances: new Map(Array.from(auction.masters.keys()).map(masterId => [masterId, startingBudget])),
        purchases: new Map(Array.from(auction.masters.entries()).map(([id, master]) => [id, []])),
    };


    console.log(`[auction:start] auction=${auction.name} rules=${JSON.stringify(auction.rules)}`);

    await interaction.reply(replyBuilder({
        description: `Auction **${auction.name}** will begin shortly! Meanwhile...`
    }));

    await sleep(3000);
    await interaction.followUp(replyBuilder({
        title: 'Rules of the auction',
        description: `- Each master will start with **${auction.rules?.startingBudget}🪙**`
            + `\n- Each master can acquire a maximum of **${auction.rules?.maxSlavesPerMaster}** slaves.`
            + `\n- Each round will begin with one of the masters (in rotating order) declaring which slave they'd like to see being bid on next. The master who nominated the slave **must** bid at least 1🪙 on it.`
            + `\n- Each round can last a maximum of **${Math.round(auction.rules?.roundDurationMs / 1000 / 60)}** minutes. If a master has not placed their bid within this time, the minimum possible amount will be placed for them automatically.`
            + `\n- Masters must hold **at least** 1🪙 for each slave they're yet to acquire for their plantation.`
            + `\n- ${priorityType === 'fixed' ? 'Ties will be resolved based on the masters\' rankings. Higher-ranked masters will be given preference over lower-ranked masters.' : 'Priority order for resolving ties will keep rotating each round.'}`
            + `\n- The auction will end once all the slaves have been sold.`,
        footer: `Use the \`/auction view-status\` command at any time to check the current status of the auction.`,
        color: 'violet-500'
    }));

    await sleep(5000);
    await interaction.followUp(replyBuilder({
        title: 'Meet the masters',
        description: `The following masters will be bidding in this auction${priorityType === 'fixed' ? ' (in ranked order)' : ''}:\n`
            + startingPriorityOrder.map((masterId, index) => {
                return `${index + 1}. <@${masterId}>`;
            }).join('\n'),
        color: 'violet-500'
    }));

    await sleep(5000);
    await interaction.followUp(replyBuilder({
        title: 'Meet the slaves',
        description: 'The following slaves will be up for grabs in this auction:\n' + Array.from(auction.slaves.values()).map((slave, index) => {
            // return `${index + 1}. <@${slave.id}>\n  - **Specialties:** ${slave.specialties ?? 'None'}`;
            return `${index + 1}. <@${slave.id}> (${slave.specialty.toLowerCase()})`;
        }).join('\n'),
        color: 'violet-500'
    }));

    await sleep(5000);

    const firstNominatorId = startingPriorityOrder[0];
    if (firstNominatorId) {
        await interaction.followUp(replyBuilder({
            description: `The first slave will be nominated by <@${firstNominatorId}>.`,
            color: 'blue-400',
        }));
    }
}