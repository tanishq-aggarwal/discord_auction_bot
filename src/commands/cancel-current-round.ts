import type { ChatInputCommandInteraction } from "discord.js";
import { clearActiveRound } from "../domain/auctionLifecycle.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";
import { getAuctionForCommand } from "./auctionCommandGuards.js";

export async function cancelCurrentRound(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);
    const auction = await getAuctionForCommand(interaction, auctionName, {
        allowedStatuses: ["LIVE"],
        requireAuctionChannel: true,
    });
    if (!auction) return;

    if (!auction.currentRoundState) {
        await interaction.reply(errorReplyBuilder({ description: "There is no active round to cancel." }));
        return;
    }

    const round = clearActiveRound(auction);
    if (!round) return;

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
                    } catch (error) {
                        console.warn("[auction:cancel-round:edit-status-message]", error);
                    }
                }
            }
        } catch (error) {
            console.warn("[auction:cancel-round:fetch-channel]", error);
        }
    }

    console.log(`[auction:cancel-round] auction=${auction.name} nominee=${round.nomineeTag ?? round.nomineeId}`);
    await interaction.reply(
        replyBuilder({
            description: "Ongoing round has been cancelled.",
            ephemeral: false,
            color: "blue-400",
        }),
    );
}
