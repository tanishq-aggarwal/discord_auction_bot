import { EmbedBuilder, MessageFlags, type InteractionReplyOptions } from "discord.js";
import { msToS, type milliseconds } from "./common.js";

/**
 * Converts a timestamp in milliseconds to a relative Discord timestamp string.
 * @param forTimestamp - The timestamp in milliseconds.
 * @returns A string representing the relative Discord timestamp.
 */
export function getRelativeDiscordTimestamp(forTimestamp: milliseconds): string {
    return `<t:${msToS(forTimestamp)}:R>`;
}

/**
 * Builds an error reply embed with a tailwind red-500 color.
 * @param message - The error message to display.
 * @returns An InteractionReplyOptions object with the error embed and ephemeral flag.
 */
export function errorReplyBuilder(message: string, ephemeral = true, title?: string): InteractionReplyOptions {
    const embed = new EmbedBuilder()
        .setColor(0xef4444) // tailwind red-500
        .setDescription(message);
    if (title) {
        embed.setTitle(title);
    }

    return {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    }
}


export function infoReplyBuilder(message: string, ephemeral?: boolean, title?: string): InteractionReplyOptions {
    const embed = new EmbedBuilder()
        .setColor(0x60a5fa) // tailwind blue-500
        .setDescription(message);
    if (title) {
        embed.setTitle(title);
    }

    return {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    }
}