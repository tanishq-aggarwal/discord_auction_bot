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

export function infoReplyBuilder({ plaintextMessage, description, ephemeral = false, title, author, thumbnailURL, fields, footer }: {
    plaintextMessage?: string,
    description?: string,
    author?: EmbedAuthor,
    thumbnailURL?: string,
    title?: string,
    fields?: Record<string, string>,
    footer?: string,
    ephemeral?: boolean,
}): InteractionReplyOptions {
    const embed = new EmbedBuilder().setColor(0x60a5fa); // tailwind blue-500
    if (description) {
        embed.setDescription(description);
    }
    if (title) {
        embed.setTitle(title);
    }
    if (author) {
        embed.setAuthor(author);
    }
    if (thumbnailURL) {
        embed.setThumbnail(thumbnailURL);
    }
    if (fields) {
        for (const [key, value] of Object.entries(fields)) {
            embed.addFields({ name: key, value, inline: true });
        }
    }
    if (footer) {
        embed.setFooter({ text: footer });
    }

    const replyOptions: InteractionReplyOptions = {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    };
    if (plaintextMessage) {
        replyOptions.content = plaintextMessage;
    }
    return replyOptions;
}