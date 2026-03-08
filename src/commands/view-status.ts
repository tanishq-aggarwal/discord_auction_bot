import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { Auction, Master, Slave } from "../database/auctionStore.js";
import { auctions, guildConfigs } from "../database/global.js";
import { colorsMap, errorReplyBuilder } from "../utils/discord-utils.js";

type MasterSummary = {
    masterId: Master["id"];
    balance: number;
    ownedSlaveIds: Slave["id"][];
};

function getOwnedSlaveIdSet(auction: Auction): Set<Slave["id"]> {
    if (!auction.state) return new Set();

    const owned = new Set<Slave["id"]>();
    for (const slaveIds of auction.state.purchases.values()) {
        for (const slaveId of slaveIds) {
            owned.add(slaveId);
        }
    }
    return owned;
}

function buildMasterSummaries(auction: Auction): MasterSummary[] {
    if (!auction.state) return [];

    return Array.from(auction.masters.keys()).map(masterId => ({
        masterId,
        balance: auction.state!.balances.get(masterId) ?? 0,
        ownedSlaveIds: auction.state!.purchases.get(masterId) ?? [],
    }));
}

function formatBalances(summaries: MasterSummary[]): string {
    if (!summaries.length) return "_No masters configured._";
    return summaries
        .map(({ masterId, balance }) => `- <@${masterId}>: **${balance}🪙**`)
        .join("\n");
}

function formatOwnedSlaves(auction: Auction, summaries: MasterSummary[]): string {
    if (!summaries.length) return "_No masters configured._";

    return summaries
        .map(({ masterId, ownedSlaveIds }) => {
            if (!ownedSlaveIds.length) return `- <@${masterId}> owns _no one yet_`;

            const slaveList = ownedSlaveIds
                .map(slaveId => `<@${slaveId}>`)
                .join(", ");
            return `- <@${masterId}> owns ${slaveList}`;
        })
        .join("\n");
}

function formatUnownedSlaves(auction: Auction, ownedSlaveIds: Set<Slave["id"]>): string {
    const remainingSlaves = Array.from(auction.slaves.values()).filter(slave => !ownedSlaveIds.has(slave.id));

    if (!remainingSlaves.length) return "_All slaves have been sold._";

    return remainingSlaves
        .map(slave => `- <@${slave.id}> (${slave.specialty.toLowerCase()})`)
        .join("\n");
}

export function buildAuctionStatusEmbed(auction: Auction): EmbedBuilder {
    const ownedSlaveIds = getOwnedSlaveIdSet(auction);
    const masterSummaries = buildMasterSummaries(auction);
    const maxSlavesPerMaster = auction.rules?.maxSlavesPerMaster ?? 0;
    const totalSold = ownedSlaveIds.size;
    const totalSlaves = auction.slaves.size;

    return new EmbedBuilder()
        .setColor(colorsMap["violet-500"])
        .setTitle("📊 __Auction Status__")
        .setDescription(
            `💰 **Balances**\n` +
            `${formatBalances(masterSummaries)}` +

            `\n\n\n⛓️ **Purchases So Far**\n` +
            `${formatOwnedSlaves(auction, masterSummaries)}` +

            `\n\n\n🛍️ **Slaves Yet To Be Purchased**\n` +
            `${formatUnownedSlaves(auction, ownedSlaveIds)}`
        )
}

export async function viewStatus(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);
    const auction = auctions.getByName(interaction.guildId!, auctionName);
    const adminRoleId = guildConfigs.getAdminRoleId(interaction.guildId!);
    const roleIds: string[] =
        interaction.member
            ? Array.isArray(interaction.member.roles)
                ? interaction.member.roles
                : [...interaction.member.roles.cache.keys()]
            : [];
    const isAuctionAdmin = adminRoleId ? roleIds.includes(adminRoleId) : false;

    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** not found.` }));
        return;
    }

    if (auction.status === "INIT" || !auction.state) {
        await interaction.reply(errorReplyBuilder({
            description: `Auction **${auctionName}** has not started yet. Please run \`/auction start\` first.`,
        }));
        return;
    }

    await interaction.reply({
        embeds: [buildAuctionStatusEmbed(auction)],
        flags: isAuctionAdmin ? undefined : MessageFlags.Ephemeral,
    });
}
