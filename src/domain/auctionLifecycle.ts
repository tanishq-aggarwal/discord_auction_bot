import type { Auction, AuctionRules, Master, RoundState, Slave } from "../database/auctionStore.js";
import { getPriorityOrderForNextRound, getRoundWinner, isAuctionSoldOut, type RoundWinner } from "./roundRules.js";

export type StartAuctionInput = {
    channelId: string;
    startingBudget: number;
    roundDurationMs: number;
    maxSlavesPerMaster: number;
    priorityType: AuctionRules["priorityType"];
    startingPriorityOrder: Master["id"][];
    startedAt?: number;
};

export type BeginRoundInput = {
    nomineeId: Slave["id"];
    nominatedById: Master["id"];
    nomineeTag?: string;
    nomineeAvatarURL?: string;
    startedAt?: number;
};

export type UndoRoundResult =
    | { kind: "nothing-to-undo" }
    | { kind: "no-purchase"; round: RoundState }
    | { kind: "reverted"; round: RoundState; winner: RoundWinner }
    | { kind: "inconsistent"; round: RoundState; winner: RoundWinner };

export function initializeAuction(auction: Auction, input: StartAuctionInput): void {
    if (auction.status !== "INIT") {
        throw new Error("Only an auction in its initial state can be started.");
    }

    clearActiveRound(auction, false);
    delete auction.lastRoundState;
    delete auction.nextRoundPriorityOrder;
    auction.channelId = input.channelId;
    auction.status = "LIVE";
    auction.rules = {
        startingBudget: input.startingBudget,
        roundDurationMs: input.roundDurationMs,
        maxSlavesPerMaster: input.maxSlavesPerMaster,
        priorityType: input.priorityType,
        startingPriorityOrder: [...input.startingPriorityOrder],
    };
    auction.state = {
        startedAt: input.startedAt ?? Date.now(),
        balances: new Map(Array.from(auction.masters.keys()).map((masterId) => [masterId, input.startingBudget])),
        purchases: new Map(Array.from(auction.masters.keys()).map((masterId) => [masterId, []])),
    };
}

export function beginRound(auction: Auction, input: BeginRoundInput): RoundState {
    if (auction.status !== "LIVE" || !auction.rules || !auction.state) {
        throw new Error("The auction is not ready to start a round.");
    }
    if (auction.currentRoundState) {
        throw new Error("A round is already active.");
    }

    const startedAt = input.startedAt ?? Date.now();
    const round: RoundState = {
        nomineeId: input.nomineeId,
        nominatedById: input.nominatedById,
        startedAt,
        deadline: startedAt + auction.rules.roundDurationMs,
        priorityOrder: getPriorityOrderForNextRound(auction),
        bids: new Map(),
    };
    if (input.nomineeTag !== undefined) round.nomineeTag = input.nomineeTag;
    if (input.nomineeAvatarURL !== undefined) round.nomineeAvatarURL = input.nomineeAvatarURL;

    auction.currentRoundState = round;
    delete auction.nextRoundPriorityOrder;
    return round;
}

export function clearActiveRound(auction: Auction, preservePriority = true): RoundState | null {
    const round = auction.currentRoundState;
    if (!round) return null;

    if (round.timeoutHandle) {
        clearTimeout(round.timeoutHandle);
        delete round.timeoutHandle;
    }
    delete auction.currentRoundState;
    if (preservePriority) {
        auction.nextRoundPriorityOrder = [...round.priorityOrder];
    }
    return round;
}

export function resetAuctionState(auction: Auction): void {
    clearActiveRound(auction, false);
    delete auction.lastRoundState;
    delete auction.nextRoundPriorityOrder;
    delete auction.state;
    delete auction.rules;
    auction.channelId = null;
    auction.status = "INIT";
}

export function finalizeRoundState(auction: Auction, round: RoundState): RoundWinner | null {
    if (auction.currentRoundState !== round) {
        throw new Error("Cannot finalize a round that is no longer active.");
    }
    if (!auction.state) {
        throw new Error("Cannot finalize a round without auction state.");
    }

    const winner = getRoundWinner(round);
    if (winner) {
        const purchases = auction.state.purchases.get(winner.winnerId);
        const balance = auction.state.balances.get(winner.winnerId);
        if (!purchases || balance === undefined) {
            throw new Error("The winning master is missing from auction state.");
        }
        if (purchases.includes(round.nomineeId)) {
            throw new Error("The nominated slave is already owned by the winner.");
        }
        purchases.push(round.nomineeId);
        auction.state.balances.set(winner.winnerId, balance - winner.winningBid);
    }

    auction.lastRoundState = round;
    delete auction.currentRoundState;
    delete auction.nextRoundPriorityOrder;

    if (isAuctionSoldOut(auction)) {
        auction.status = "CLOSED";
        auction.state.endedAt = Date.now();
    }
    return winner;
}

export function undoLastRoundState(auction: Auction): UndoRoundResult {
    const round = auction.lastRoundState;
    if (!round) return { kind: "nothing-to-undo" };
    if (!auction.state) {
        throw new Error("Cannot undo a round without auction state.");
    }

    const winner = getRoundWinner(round);
    if (!winner) {
        auction.nextRoundPriorityOrder = [...round.priorityOrder];
        delete auction.lastRoundState;
        return { kind: "no-purchase", round };
    }

    const purchases = auction.state.purchases.get(winner.winnerId);
    if (!purchases) return { kind: "inconsistent", round, winner };
    const nomineeIndex = purchases.lastIndexOf(round.nomineeId);
    if (nomineeIndex === -1) return { kind: "inconsistent", round, winner };

    purchases.splice(nomineeIndex, 1);
    const currentBalance = auction.state.balances.get(winner.winnerId) ?? 0;
    auction.state.balances.set(winner.winnerId, currentBalance + winner.winningBid);
    auction.nextRoundPriorityOrder = [...round.priorityOrder];
    delete auction.lastRoundState;

    if (auction.status === "CLOSED") {
        auction.status = "LIVE";
        delete auction.state.endedAt;
    }
    return { kind: "reverted", round, winner };
}
