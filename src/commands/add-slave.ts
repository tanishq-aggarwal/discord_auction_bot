import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";
import type { Slave } from "../database/auctionStore.js";

export async function addSlave(interaction: ChatInputCommandInteraction) {
    
    const auctionName = interaction.options.getString('auction_name', true);
    const player = interaction.options.getUser('player', true);
    const specialty = interaction.options.getString('specialty', true);
    
    try {
        const auction = auctions.addSlave(interaction.guildId!, auctionName, player.id, player.tag, specialty as Slave["specialty"]);

        console.log(`[auction:add-slave] guild=${interaction.guildId!} auction=${auctionName} player=${player.tag}`);
        await interaction.reply(replyBuilder({
            // author: {
            //     name: player.tag,
            //     iconURL: player.displayAvatarURL(),
            // },
            title: `__${player.tag}__ — ${specialty.toLowerCase()}`,
            thumbnailURL: player.displayAvatarURL(),
            description: `has been successfully enslaved for **${auction.name}** auction.`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add slave. Please try again.';
        await interaction.reply(errorReplyBuilder({description: message}));
    }
}