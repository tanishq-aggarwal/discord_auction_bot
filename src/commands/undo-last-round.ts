import type { ChatInputCommandInteraction } from "discord.js";
import { undoLastRoundState } from "../domain/auctionLifecycle.js";
import { errorReplyBuilder, replyBuilder } from "../utils/discord-utils.js";
import { getAuctionForCommand } from "./auctionCommandGuards.js";

export async function undoLastRound(interaction: ChatInputCommandInteraction) {
    const auctionName = interaction.options.getString("auction_name", true);
    const auction = await getAuctionForCommand(interaction, auctionName, {
        allowedStatuses: ["LIVE", "CLOSED"],
        requireRuntimeState: true,
        requireAuctionChannel: true,
    });
    if (!auction) return;

    if (auction.currentRoundState) {
        await interaction.reply(
            errorReplyBuilder({
                description:
                    "A new round is currently ongoing. Run `/auction cancel-current-round` first before running this command.",
            }),
        );
        return;
    }

    const result = undoLastRoundState(auction);
    if (result.kind === "nothing-to-undo") {
        await interaction.reply(errorReplyBuilder({ description: "There is no previous round to undo." }));
        return;
    }
    if (result.kind === "no-purchase") {
        await interaction.reply(
            replyBuilder({
                description: `Previous round for <@${result.round.nomineeId}> had no winning bid, so there were no state changes to revert.`,
            }),
        );
        return;
    }
    if (result.kind === "inconsistent") {
        await interaction.reply(
            errorReplyBuilder({
                description:
                    "Could not undo the previous round because the expected purchase was not found in auction state.",
            }),
        );
        return;
    }

    console.log(
        `[auction:undo-last-round] auction=${auction.name} nominee=${result.round.nomineeTag ?? result.round.nomineeId} winner=${result.winner.winnerId} bid=${result.winner.winningBid}`,
    );
    await interaction.reply(
        replyBuilder({
            description: `Reverted the previous round.\n\n- **Slave:** <@${result.round.nomineeId}>\n- **Was bought by:** <@${result.winner.winnerId}>\n- **Coins restored:** ${result.winner.winningBid}🪙`,
            color: "blue-400",
        }),
    );
}
