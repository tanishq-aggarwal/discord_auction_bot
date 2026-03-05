import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";


export async function addMaster(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString('auction_name', true);
    const player = interaction.options.getUser('player', true);

    try {
        const auction = auctions.addMaster(interaction.guildId!, auctionName, player.id, player.tag);

        console.log(`[auction:add-master] guild=${interaction.guildId!} auction=${auctionName} player=${player.tag}`);
        await interaction.reply(replyBuilder({
            author: {
                name: player.tag,
                iconURL: player.displayAvatarURL(),
            },
            description: `has been promoted to a master for **${auction.name}** auction.`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add master. Please try again.';
        await interaction.reply(errorReplyBuilder({description: message}));
    }
}