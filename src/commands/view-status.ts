import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { Auction, Master, Slave } from "../database/auctionStore.js";
import { guildConfigs } from "../database/global.js";
import { getMemberRoleIds } from "../utils/auth.js";
import { colorsMap } from "../utils/discord-utils.js";
import { getAuctionForCommand } from "./auctionCommandGuards.js";

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

    return Array.from(auction.masters.keys()).map((masterId) => ({
        masterId,
        balance: auction.state!.balances.get(masterId) ?? 0,
        ownedSlaveIds: auction.state!.purchases.get(masterId) ?? [],
    }));
}

function formatBalances(summaries: MasterSummary[]): string {
    if (!summaries.length) return "_No masters configured._";
    return summaries.map(({ masterId, balance }) => `- <@${masterId}>: **${balance}🪙**`).join("\n");
}

function formatOwnedSlaves(summaries: MasterSummary[]): string {
    if (!summaries.length) return "_No masters configured._";

    return summaries
        .map(({ masterId, ownedSlaveIds }) => {
            if (!ownedSlaveIds.length) return `- <@${masterId}> owns _no one yet_`;

            const slaveList = ownedSlaveIds.map((slaveId) => `<@${slaveId}>`).join(", ");
            return `- <@${masterId}> owns ${slaveList}`;
        })
        .join("\n");
}

function formatUnownedSlaves(auction: Auction, ownedSlaveIds: Set<Slave["id"]>): string {
    const remainingSlaves = Array.from(auction.slaves.values()).filter((slave) => !ownedSlaveIds.has(slave.id));

    if (!remainingSlaves.length) return "_All slaves have been sold._";

    return remainingSlaves.map((slave) => `- <@${slave.id}> (${slave.specialty.toLowerCase()})`).join("\n");
}

export function buildAuctionStatusEmbed(auction: Auction): EmbedBuilder {
    const ownedSlaveIds = getOwnedSlaveIdSet(auction);
    const masterSummaries = buildMasterSummaries(auction);
    return new EmbedBuilder()
        .setColor(colorsMap["violet-500"])
        .setTitle("📊 __Auction Status__")
        .setDescription(
            `💰 **Balances**\n` +
                `${formatBalances(masterSummaries)}` +
                `\n\n\n⛓️ **Purchases So Far**\n` +
                `${formatOwnedSlaves(masterSummaries)}` +
                `\n\n\n🛍️ **Slaves Yet To Be Purchased**\n` +
                `${formatUnownedSlaves(auction, ownedSlaveIds)}`,
        );
}

export async function viewStatus(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);
    const auction = await getAuctionForCommand(interaction, auctionName, {
        allowedStatuses: ["LIVE", "CLOSED"],
        requireRuntimeState: true,
    });
    if (!auction) return;

    const adminRoleId = guildConfigs.getAdminRoleId(interaction.guildId!);
    const isAuctionAdmin = adminRoleId ? getMemberRoleIds(interaction.member).includes(adminRoleId) : false;

    await interaction.reply({
        embeds: [buildAuctionStatusEmbed(auction)],
        flags: isAuctionAdmin ? undefined : MessageFlags.Ephemeral,
    });
}
