import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, infoReplyBuilder } from "../utils/discord-utils.js";

export async function addSlave(interaction: ChatInputCommandInteraction) {
    
    const auctionName = interaction.options.getString('auction_name', true);
    const player = interaction.options.getUser('player', true);
    
    try {
        const auction = auctions.addSlave(interaction.guildId!, auctionName, player.id, player.tag);

        console.log(`[auction:add-slave] guild=${interaction.guildId!} auction=${auctionName} player=${player.tag} (${player.id})`);
        await interaction.reply(infoReplyBuilder(
            `Added **${player.tag}** to **${auction.name}** slave pool.`,
        ));
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to add slave.';
        await interaction.reply(errorReplyBuilder(msg));
    }
}