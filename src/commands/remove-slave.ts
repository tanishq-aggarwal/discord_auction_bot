import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";

export async function removeSlave(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);
    const slave = interaction.options.getUser('slave', true);

    try {
        const auction = auctions.removeSlave(interaction.guildId!, auctionName, slave.id, slave.tag);
        console.log(`[auction:remove-slave] guild=${interaction.guildId!} auction=${auctionName} slave=${slave.tag}`);
        await interaction.reply(replyBuilder({
            author: {
                name: slave.tag,
                iconURL: slave.displayAvatarURL(),
            },
            description: `has been freed from **${auction.name}** auction.`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove slave. Please try again.';
        await interaction.reply(errorReplyBuilder({description: message}));
    }
}