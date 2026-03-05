import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";


export async function updateSlaveSpecialties(interaction: ChatInputCommandInteraction) {
    const slave = interaction.options.getUser('slave', true);
    const specialties = interaction.options.getString('specialties', true);

    try {
        auctions.updateSlaveSpecialties(interaction.guildId!, slave.id, slave.tag, specialties);

        console.log(`[auction:update-slave-specialties] guild=${interaction.guildId!} slave=${slave.tag} specialties=${specialties}`);
        await interaction.reply(replyBuilder({
            // author: {
            //     name: slave.tag,
            //     iconURL: slave.displayAvatarURL(),
            // },
            title: `${slave.tag}`,
            thumbnailURL: slave.displayAvatarURL(),
            description: `**Specialties:** ${specialties}`,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update slave specialties. Please try again.';
        await interaction.reply(errorReplyBuilder({description: message}));
    }
}