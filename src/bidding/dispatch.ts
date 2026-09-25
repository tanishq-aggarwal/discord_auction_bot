import type { ButtonInteraction, Client, ModalSubmitInteraction } from "discord.js";
import type { Auction } from "../database/auctionStore.js";
import { resumePersistedSealedRounds } from "./sealed/coordinator.js";
import { isSealedCustomId } from "./sealed/customIds.js";
import { handleSealedBidButton, handleSealedBidModal } from "./sealed/interactions.js";
import { clearSealedRound, undoSealedRound, type UndoRoundResult } from "./sealed/roundLifecycle.js";
import type { SealedRoundState } from "./sealed/types.js";

export async function handleBidButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!isSealedCustomId(interaction.customId)) return false;
    return handleSealedBidButton(interaction);
}

export async function handleBidModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!isSealedCustomId(interaction.customId)) return false;
    return handleSealedBidModal(interaction);
}

export function resumePersistedRounds(client: Client): void {
    resumePersistedSealedRounds(client);
}

export function clearActiveRound(auction: Auction): SealedRoundState | null {
    return clearSealedRound(auction);
}

export function undoLastRound(auction: Auction): UndoRoundResult {
    return undoSealedRound(auction);
}
