import type { Auction, Master } from "../../database/auctionStore.js";
import { computeMaxBidAllowed, getRemainingSlots } from "../../domain/economy.js";
import { getNextNominatorId } from "../../domain/nomination.js";
import type { SealedBid, SealedRoundState, SealedRoundWinner } from "./types.js";

export function getMinimumBidForRound(round: SealedRoundState, masterId: Master["id"]): number {
    return round.nominatedById === masterId ? 1 : 0;
}

export function getEligibleMasterIdsForRound(auction: Auction, round: SealedRoundState): Master["id"][] {
    return Array.from(auction.masters.keys()).filter((masterId) => {
        if (getRemainingSlots(auction, masterId) <= 0) return false;
        return computeMaxBidAllowed(auction, masterId) >= getMinimumBidForRound(round, masterId);
    });
}

export function areAllBidsReceived(auction: Auction, round: SealedRoundState): boolean {
    return getEligibleMasterIdsForRound(auction, round).every((masterId) => round.bids.has(masterId));
}

export function autoSubmitMissingBids(auction: Auction, round: SealedRoundState, submittedAt = Date.now()): void {
    for (const masterId of getEligibleMasterIdsForRound(auction, round)) {
        if (round.bids.has(masterId)) continue;
        const bid: SealedBid = {
            amount: getMinimumBidForRound(round, masterId),
            isAuto: true,
            submittedAt,
        };
        round.bids.set(masterId, bid);
    }
}

export function getRoundWinner(round: SealedRoundState): SealedRoundWinner | null {
    const bids = Array.from(round.bids.entries());
    if (bids.length === 0) return null;

    const highestBid = Math.max(...bids.map(([, bid]) => bid.amount));
    const tiedMasterIds = new Set(bids.filter(([, bid]) => bid.amount === highestBid).map(([masterId]) => masterId));
    const winnerId =
        round.priorityOrder.find((masterId) => tiedMasterIds.has(masterId)) ??
        bids.find(([, bid]) => bid.amount === highestBid)?.[0];

    return winnerId ? { winnerId, winningBid: highestBid } : null;
}

export function rotatePriorityOrder(priorityOrder: Master["id"][]): Master["id"][] {
    if (priorityOrder.length < 2) return [...priorityOrder];
    return priorityOrder.slice(1).concat(priorityOrder[0]!);
}

export function compactInactiveMasters(auction: Auction, priorityOrder: Master["id"][]): Master["id"][] {
    const active: Master["id"][] = [];
    const inactive: Master["id"][] = [];
    for (const masterId of priorityOrder) {
        if (getRemainingSlots(auction, masterId) > 0) active.push(masterId);
        else inactive.push(masterId);
    }
    return active.concat(inactive);
}

function readSealedPriority(round: Auction["lastRoundState"]): Master["id"][] | null {
    if (!round || !("priorityOrder" in round) || !Array.isArray(round.priorityOrder)) return null;
    return round.priorityOrder;
}

export function getPriorityOrderForNextRound(auction: Auction): Master["id"][] {
    if (!auction.rules) return [];

    let nextOrder: Master["id"][];
    if (auction.nextRoundPriorityOrder) {
        nextOrder = [...auction.nextRoundPriorityOrder];
    } else if (auction.rules.priorityType === "fixed" || !auction.lastRoundState) {
        nextOrder = [...auction.rules.startingPriorityOrder];
    } else {
        nextOrder = rotatePriorityOrder(readSealedPriority(auction.lastRoundState) ?? []);
    }

    return auction.rules.priorityType === "rotating" ? compactInactiveMasters(auction, nextOrder) : nextOrder;
}

export function getVisiblePriorityOrder(auction: Auction, priorityOrder: Master["id"][]): Master["id"][] {
    return priorityOrder.filter((masterId) => getRemainingSlots(auction, masterId) > 0);
}

export function canMasterBeObligatedNominator(auction: Auction, masterId: Master["id"]): boolean {
    return getRemainingSlots(auction, masterId) > 0 && computeMaxBidAllowed(auction, masterId) >= 1;
}

export function getNextObligatedMasterId(auction: Auction, afterMasterId?: Master["id"]): Master["id"] | null {
    let candidate =
        afterMasterId !== undefined
            ? getNextNominatorId(auction, afterMasterId)
            : (auction.nextNominatorId ?? getNextNominatorId(auction, auction.lastRoundState?.nominatedById));

    const seen = new Set<Master["id"]>();
    while (candidate && !seen.has(candidate)) {
        if (canMasterBeObligatedNominator(auction, candidate)) return candidate;
        seen.add(candidate);
        candidate = getNextNominatorId(auction, candidate);
    }

    return candidate && canMasterBeObligatedNominator(auction, candidate) ? candidate : null;
}
