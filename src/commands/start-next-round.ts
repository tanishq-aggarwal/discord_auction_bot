import type { ChatInputCommandInteraction } from "discord.js";
import {
    describeObligatedMasterError,
    launchSealedRound,
    readOptionalRoundDurationMs,
} from "../bidding/sealed/launchRound.js";
import { getOwnerId } from "../domain/economy.js";
import { describeNominationCommandMismatch } from "../domain/nomination.js";
import { errorReplyBuilder } from "../utils/discord-utils.js";
import { getAuctionForCommand } from "./auctionCommandGuards.js";

export async function startNextRound(interaction: ChatInputCommandInteraction): Promise<void> {
    const auctionName = interaction.options.getString("auction_name", true);
    const nominatedSlave = interaction.options.getUser("nominated_slave", true);
    const nominatedBy = interaction.options.getUser("nominated_by", true);
    const auction = await getAuctionForCommand(interaction, auctionName, {
        allowedStatuses: ["LIVE"],
        requireRuntimeState: true,
        requireAuctionChannel: true,
    });
    if (!auction) return;

    const commandMismatch = describeNominationCommandMismatch(auction, "manual");
    if (commandMismatch) {
        await interaction.reply(errorReplyBuilder({ description: commandMismatch }));
        return;
    }
    if (!auction.slaves.has(nominatedSlave.id)) {
        await interaction.reply(
            errorReplyBuilder({
                description: `<@${nominatedSlave.id}> is not a slave in this auction. Please select a valid slave.`,
            }),
        );
        return;
    }
    const obligatedMasterError = describeObligatedMasterError(auction, nominatedBy.id);
    if (obligatedMasterError) {
        await interaction.reply(errorReplyBuilder({ description: obligatedMasterError }));
        return;
    }
    const ownerId = getOwnerId(auction, nominatedSlave.id);
    if (ownerId) {
        await interaction.reply(
            errorReplyBuilder({
                description: `<@${nominatedSlave.id}> is already owned by <@${ownerId}>. Please select a different slave.`,
            }),
        );
        return;
    }
    if (auction.currentRoundState) {
        await interaction.reply(
            errorReplyBuilder({
                description:
                    "A round is already in progress. Please wait for it to finish before starting a new round.",
            }),
        );
        return;
    }

    const roundDuration = readOptionalRoundDurationMs(interaction);
    if (roundDuration.error) {
        await interaction.reply(errorReplyBuilder({ description: roundDuration.error }));
        return;
    }

    await launchSealedRound(interaction, auction, {
        nomineeId: nominatedSlave.id,
        nominatedById: nominatedBy.id,
        nomineeTag: nominatedSlave.tag,
        nomineeAvatarURL: nominatedSlave.displayAvatarURL(),
        ...(roundDuration.durationMs !== undefined ? { roundDurationMs: roundDuration.durationMs } : {}),
    });
}
