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
export function errorReplyBuilder({ message, ephemeral = true, title, author }: {
    author?: EmbedAuthor,
    title?: string,
    message: string,
    ephemeral?: boolean,
}): InteractionReplyOptions {
    const embed = new EmbedBuilder()
        .setColor(0xef4444) // tailwind red-500
        .setDescription(message);
    if (title) {
        embed.setTitle(title);
    }
    if (author) {
        embed.setAuthor(author);
    }

    return {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    }
}


type EmbedAuthor = {
    name: string;
    iconURL?: string;
};

export function infoReplyBuilder({ message, ephemeral = false, title, author }: {
    author?: EmbedAuthor,
    title?: string,
    message: string,
    ephemeral?: boolean,
}): InteractionReplyOptions {
    const embed = new EmbedBuilder()
        .setColor(0x60a5fa) // tailwind blue-500
        .setDescription(message);
    if (title) {
        embed.setTitle(title);
    }
    if (author) {
        embed.setAuthor(author);
    }

    return {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    }
}