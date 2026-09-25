import type { ChatInputCommandInteraction } from "discord.js";
import {
    describeObligatedMasterError,
    launchSealedRound,
    readOptionalRoundDurationMs,
} from "../bidding/sealed/launchRound.js";
import { getNextObligatedMasterId } from "../bidding/sealed/rules.js";
import { describeNominationCommandMismatch, pickRandomUnpurchasedSlave } from "../domain/nomination.js";
import { errorReplyBuilder } from "../utils/discord-utils.js";
import { getAuctionForCommand } from "./auctionCommandGuards.js";

export async function startNextRandomRound(interaction: ChatInputCommandInteraction): Promise<void> {
    const auctionName = interaction.options.getString("auction_name", true);
    const nominatedByOverride = interaction.options.getUser("nominated_by", false);
    const auction = await getAuctionForCommand(interaction, auctionName, {
        allowedStatuses: ["LIVE"],
        requireRuntimeState: true,
        requireAuctionChannel: true,
    });
    if (!auction) return;

    const commandMismatch = describeNominationCommandMismatch(auction, "random");
    if (commandMismatch) {
        await interaction.reply(errorReplyBuilder({ description: commandMismatch }));
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

    const nominatedById = nominatedByOverride?.id ?? getNextObligatedMasterId(auction);
    if (!nominatedById) {
        await interaction.reply(
            errorReplyBuilder({
                description:
                    "No master can be obligated for this round. Every remaining master is either finished or cannot bid at least 1🪙.",
            }),
        );
        return;
    }

    const obligatedMasterError = describeObligatedMasterError(auction, nominatedById);
    if (obligatedMasterError) {
        await interaction.reply(errorReplyBuilder({ description: obligatedMasterError }));
        return;
    }

    const nominatedSlave = pickRandomUnpurchasedSlave(auction);
    if (!nominatedSlave) {
        await interaction.reply(
            errorReplyBuilder({
                description: "There are no unpurchased slaves left to nominate.",
            }),
        );
        return;
    }

    const roundDuration = readOptionalRoundDurationMs(interaction);
    if (roundDuration.error) {
        await interaction.reply(errorReplyBuilder({ description: roundDuration.error }));
        return;
    }

    await interaction.deferReply();

    let nomineeTag = nominatedSlave.tag;
    let nomineeAvatarURL: string | undefined;
    try {
        const nomineeUser = await interaction.client.users.fetch(nominatedSlave.id);
        nomineeTag = nomineeUser.tag;
        nomineeAvatarURL = nomineeUser.displayAvatarURL();
    } catch (error) {
        console.warn("[auction:start-next-random-round:fetch-nominee]", error);
    }

    await launchSealedRound(interaction, auction, {
        nomineeId: nominatedSlave.id,
        nominatedById,
        nomineeTag,
        ...(nomineeAvatarURL ? { nomineeAvatarURL } : {}),
        ...(roundDuration.durationMs !== undefined ? { roundDurationMs: roundDuration.durationMs } : {}),
    });
}
