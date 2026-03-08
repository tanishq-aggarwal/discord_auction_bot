import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Auction, Master, Slave } from "../database/auctionStore.js";
import { auctions } from "../database/global.js";
import { colorsMap, errorReplyBuilder } from "../utils/discord-utils.js";

function formatMasters(auction: Auction): string {
    const masters = Array.from(auction.masters.values());
    if (!masters.length) return "_No masters added yet._";

    return masters
        .map((master: Master, index) => `${index + 1}. <@${master.id}>`)
        .join("\n");
}

function formatSlaves(auction: Auction): string {
    const slaves = Array.from(auction.slaves.values());
    if (!slaves.length) return "_No slaves added yet._";

    return slaves
        .map((slave: Slave, index) => `${index + 1}. <@${slave.id}> (${slave.specialty.toLowerCase()})`)
        .join("\n");
}

function buildParticipantsEmbed(auction: Auction): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(colorsMap["violet-500"])
        .setTitle("👥 __Auction Participants__")
        .setDescription(
            `🎩 **Masters (${auction.masters.size})**\n` +
            `${formatMasters(auction)}` +
            `\n\n⛓️ **Slaves (${auction.slaves.size})**\n` +
            `${formatSlaves(auction)}`
        );
}

export async function viewParticipants(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);
    const auction = auctions.getByName(interaction.guildId!, auctionName);

    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** not found.` }));
        return;
    }

    await interaction.reply({
        embeds: [buildParticipantsEmbed(auction)],
    });
}
