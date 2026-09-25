import type { Auction, Master, Slave } from "../../database/auctionStore.js";
import { discardActiveRound } from "../../domain/roundActivity.js";
import { getOwnerId } from "../../domain/economy.js";
import { rememberNextNominator, restoreNominatorCursor } from "../../domain/nomination.js";
import { closeIfSoldOut, recordPurchase, refundPurchase, reopenAuction } from "../../domain/sales.js";
import { readBiddingStyle } from "../style.js";
import { canMasterBeObligatedNominator, getPriorityOrderForNextRound, getRoundWinner } from "./rules.js";
import type { SealedRoundState, SealedRoundWinner } from "./types.js";
import { isSealedRound } from "./types.js";

export type BeginRoundInput = {
    nomineeId: Slave["id"];
    nominatedById: Master["id"];
    nomineeTag?: string;
    nomineeAvatarURL?: string;
    startedAt?: number;
    roundDurationMs?: number;
};

export type UndoRoundResult =
    | { kind: "nothing-to-undo" }
    | { kind: "no-purchase"; round: SealedRoundState }
    | { kind: "reverted"; round: SealedRoundState; winner: SealedRoundWinner }
    | { kind: "inconsistent"; round: SealedRoundState; winner: SealedRoundWinner };

export function beginSealedRound(auction: Auction, input: BeginRoundInput): SealedRoundState {
    if (readBiddingStyle(auction.biddingStyle) !== "sealed") {
        throw new Error("This auction is not using sealed bidding.");
    }
    if (auction.status !== "LIVE" || !auction.rules || !auction.state) {
        throw new Error("The auction is not ready to start a round.");
    }
    if (auction.currentRoundState) {
        throw new Error("A round is already active.");
    }
    if (!auction.slaves.has(input.nomineeId)) {
        throw new Error("The nominated player is not a slave in this auction.");
    }
    const ownerId = getOwnerId(auction, input.nomineeId);
    if (ownerId) {
        throw new Error("The nominated slave is already owned.");
    }
    if (!auction.masters.has(input.nominatedById)) {
        throw new Error("The nominated-by user is not a master in this auction.");
    }
    if (!canMasterBeObligatedNominator(auction, input.nominatedById)) {
        throw new Error("The obligated master needs remaining purchase slots and enough budget to bid at least 1🪙.");
    }

    const startedAt = input.startedAt ?? Date.now();
    if (
        input.roundDurationMs !== undefined &&
        (!Number.isInteger(input.roundDurationMs) || input.roundDurationMs < 10_000 || input.roundDurationMs > 300_000)
    ) {
        throw new Error("Round duration must be between 10 and 300 seconds.");
    }
    const roundDurationMs = input.roundDurationMs ?? auction.rules.roundDurationMs;
    const round: SealedRoundState = {
        nomineeId: input.nomineeId,
        nominatedById: input.nominatedById,
        startedAt,
        deadline: startedAt + roundDurationMs,
        priorityOrder: getPriorityOrderForNextRound(auction),
        bids: new Map(),
    };
    if (input.nomineeTag !== undefined) round.nomineeTag = input.nomineeTag;
    if (input.nomineeAvatarURL !== undefined) round.nomineeAvatarURL = input.nomineeAvatarURL;

    auction.currentRoundState = round;
    delete auction.nextRoundPriorityOrder;
    return round;
}

export function clearSealedRound(auction: Auction, preservePriority = true): SealedRoundState | null {
    const round = auction.currentRoundState;
    if (!round) return null;
    if (!isSealedRound(round)) {
        throw new Error("The active round is not a sealed-bidding round.");
    }

    discardActiveRound(auction);
    if (preservePriority) {
        auction.nextRoundPriorityOrder = [...round.priorityOrder];
    }
    return round;
}

export function finalizeSealedRound(auction: Auction, round: SealedRoundState): SealedRoundWinner | null {
    if (auction.currentRoundState !== round) {
        throw new Error("Cannot finalize a round that is no longer active.");
    }
    if (!isSealedRound(round)) {
        throw new Error("Cannot finalize a round that is not sealed bidding.");
    }

    const winner = getRoundWinner(round);
    if (winner) {
        recordPurchase(auction, winner.winnerId, round.nomineeId, winner.winningBid);
    }

    auction.lastRoundState = round;
    delete auction.currentRoundState;
    delete auction.nextRoundPriorityOrder;
    rememberNextNominator(auction, round.nominatedById);
    closeIfSoldOut(auction);
    return winner;
}

export function undoSealedRound(auction: Auction): UndoRoundResult {
    const round = auction.lastRoundState;
    if (!round) return { kind: "nothing-to-undo" };
    if (!isSealedRound(round)) {
        throw new Error("The previous round is not a sealed-bidding round.");
    }

    const winner = getRoundWinner(round);
    if (!winner) {
        auction.nextRoundPriorityOrder = [...round.priorityOrder];
        delete auction.lastRoundState;
        restoreNominatorCursor(auction, round.nominatedById);
        return { kind: "no-purchase", round };
    }

    const refunded = refundPurchase(auction, winner.winnerId, round.nomineeId, winner.winningBid);
    if (!refunded) return { kind: "inconsistent", round, winner };

    auction.nextRoundPriorityOrder = [...round.priorityOrder];
    delete auction.lastRoundState;
    restoreNominatorCursor(auction, round.nominatedById);
    reopenAuction(auction);
    return { kind: "reverted", round, winner };
}
