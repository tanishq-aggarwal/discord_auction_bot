import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, infoReplyBuilder } from "../utils/discord-utils.js";

export async function addSlave(interaction: ChatInputCommandInteraction) {
    
    const auctionName = interaction.options.getString('auction_name', true);
    const player = interaction.options.getUser('player', true);
    const specialties = interaction.options.getString('specialties');
    
    try {
        const auction = auctions.addSlave(interaction.guildId!, auctionName, player.id, player.tag, specialties ?? undefined);

        console.log(`[auction:add-slave] guild=${interaction.guildId!} auction=${auctionName} player=${player.tag}`);
        await interaction.reply(infoReplyBuilder({
            // author: {
            //     name: player.tag,
            //     iconURL: player.displayAvatarURL(),
            // },
            title: `${player.tag}`,
            thumbnailURL: player.displayAvatarURL(),
            description: `**Specialties:** ${specialties ?? 'None'}\n\nhas been successfully enslaved for **${auction.name}** auction.`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add slave. Please try again.';
        await interaction.reply(errorReplyBuilder({message}));
    }
}