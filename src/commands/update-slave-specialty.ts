import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";
import type { Slave } from "../database/auctionStore.js";


export async function updateSlaveSpecialty(interaction: ChatInputCommandInteraction) {
    const slave = interaction.options.getUser('slave', true);
    const specialty = interaction.options.getString('specialty', true);

    try {
        auctions.updateSlaveSpecialty(interaction.guildId!, slave.id, slave.tag, specialty as Slave["specialty"]);

        console.log(`[auction:update-slave-specialty] guild=${interaction.guildId!} slave=${slave.tag} specialty=${specialty}`);
        await interaction.reply(replyBuilder({
            author: {
                name: slave.tag,
                iconURL: slave.displayAvatarURL(),
            },
            // title: `${slave.tag}`,
            // thumbnailURL: slave.displayAvatarURL(),
            description: `Specialty updated to **${specialty}**`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update slave specialties. Please try again.';
        await interaction.reply(errorReplyBuilder({description: message}));
    }
}