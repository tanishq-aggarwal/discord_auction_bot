import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { auctions } from "../database/global.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";

export async function cancelCurrentRound(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);

    const auction = auctions.getByName(interaction.guildId!, auctionName);
    if (!auction) {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** not found.` }));
        return;
    }

    if (auction.status === "INIT") {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** has not started yet.` }));
        return;
    }

    if (auction.status === "CLOSED") {
        await interaction.reply(errorReplyBuilder({ description: `Auction **${auctionName}** is already over.` }));
        return;
    }

    if (!auction.currentRoundState) {
        await interaction.reply(errorReplyBuilder({ description: "There is no active round to cancel." }));
        return;
    }

    if (interaction.channelId !== auction.channelId) {
        await interaction.reply(errorReplyBuilder({ description: `Please run this command in the <#${auction.channelId}> channel.` }));
        return;
    }

    const round = auction.currentRoundState;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (round.timeoutHandle) {
        clearTimeout(round.timeoutHandle);
        delete round.timeoutHandle;
    }

    delete auction.currentRoundState;

    if (auction.channelId) {
        try {
            const channel = await interaction.client.channels.fetch(auction.channelId);
            if (channel?.isTextBased() && "send" in channel) {
                if (round.statusMessageId) {
                    try {
                        const statusMessage = await channel.messages.fetch(round.statusMessageId);
                        const cancelledStatus = replyBuilder({
                            title: "❌ Round Cancelled",
                            description: `Bidding for <@${round.nomineeId}> was interrupted!\nNo changes have been made to the auction state.`,
                            color: "red-500",
                        });
                        await statusMessage.edit({
                            embeds: cancelledStatus.embeds!,
                            components: [],
                        });
                    }
                    catch (error) {
                        console.warn("[auction:cancel-round:edit-status-message]", error);
                    }
                }

                const cancelledRoundNotice = errorReplyBuilder({
                    description: `Ongoing round was cancelled.`,
                    ephemeral: false,
                });
                await channel.send({ embeds: cancelledRoundNotice.embeds! });
            }
        }
        catch (error) {
            console.warn("[auction:cancel-round:fetch-channel]", error);
        }
    }

    console.log(`[auction:cancel-round] auction=${auction.name} nominee=${round.nomineeTag ?? round.nomineeId}`);
    await interaction.deleteReply();
}
