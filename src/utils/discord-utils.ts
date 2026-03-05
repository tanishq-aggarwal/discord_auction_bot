import { EmbedBuilder, MessageFlags, type ColorResolvable, type InteractionReplyOptions } from "discord.js";
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
export function errorReplyBuilder({ description, ephemeral = true }: {
    description: string,
    ephemeral?: boolean,
}): InteractionReplyOptions {
    return replyBuilder({ description, ephemeral, color: 'red-500' });
}


type EmbedAuthor = {
    name: string;
    iconURL?: string;
};

const colorsMap: Record<string, ColorResolvable> = {
    'red-500': 0xef4444,
    'blue-400': 0x60a5fa,
    'green-500': 0x22c55e,
    'violet-500': 0x8b5cf6
};

export function replyBuilder({ plaintextMessage, description, ephemeral = false, title, author, thumbnailURL, fields, footer, color = 'blue-400' }: {
    plaintextMessage?: string,
    description?: string,
    author?: EmbedAuthor,
    thumbnailURL?: string,
    title?: string,
    fields?: Record<string, string>,
    footer?: string,
    ephemeral?: boolean,
    color?: 'red-500' | 'blue-400' | 'green-500' | 'violet-500'
}): InteractionReplyOptions {
    const embed = new EmbedBuilder().setColor(colorsMap[color]!);
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