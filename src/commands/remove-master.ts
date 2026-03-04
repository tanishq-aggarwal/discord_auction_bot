import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, infoReplyBuilder } from "../utils/discord-utils.js";

export async function removeMaster(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);
    const master = interaction.options.getUser('master', true);

    try {
        const auction = auctions.removeMaster(interaction.guildId!, auctionName, master.id, master.tag);
        console.log(`[auction:remove-master] guild=${interaction.guildId!} auction=${auctionName} master=${master.tag}`);
        await interaction.reply(infoReplyBuilder({
            author: {
                name: master.tag,
                iconURL: master.displayAvatarURL(),
            },
            description: `has been removed as a master from **${auction.name}** auction.`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove master. Please try again.';
        await interaction.reply(errorReplyBuilder({message}));
    }
}