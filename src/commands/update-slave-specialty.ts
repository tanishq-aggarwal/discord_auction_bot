import type { ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";
import { isSlaveSpecialty } from "../domain/specialties.js";

export async function updateSlaveSpecialty(interaction: ChatInputCommandInteraction) {
    const slave = interaction.options.getUser("slave", true);
    const specialty = interaction.options.getString("specialty", true);
    if (!isSlaveSpecialty(specialty)) {
        await interaction.reply(errorReplyBuilder({ description: "Invalid specialty." }));
        return;
    }

    try {
        auctions.updateSlaveSpecialtyAcrossGuildAuctions(interaction.guildId!, slave.id, slave.tag, specialty);

        console.log(
            `[auction:update-slave-specialty] guild=${interaction.guildId!} slave=${slave.tag} specialty=${specialty}`,
        );
        await interaction.reply(
            replyBuilder({
                author: {
                    name: slave.tag,
                    iconURL: slave.displayAvatarURL(),
                },
                description: `Specialty updated to **${specialty}**`,
            }),
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update slave specialties. Please try again.";
        await interaction.reply(errorReplyBuilder({ description: message }));
    }
}
