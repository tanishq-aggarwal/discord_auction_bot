import { randomInt } from "node:crypto";
import type { Auction, Bid, Master, NominationType, RoundState, Slave } from "../database/auctionStore.js";

export type RoundWinner = {
    winnerId: Master["id"];
    winningBid: number;
};

export function getRemainingSlots(auction: Auction, masterId: Master["id"]): number {
    if (!auction.rules || !auction.state || !auction.masters.has(masterId)) return 0;
    const purchasedCount = auction.state.purchases.get(masterId)?.length ?? 0;
    return Math.max(0, auction.rules.maxSlavesPerMaster - purchasedCount);
}

export function computeMaxBidAllowed(auction: Auction, masterId: Master["id"]): number {
    if (!auction.state) return 0;
    const balance = auction.state.balances.get(masterId) ?? 0;
    const remainingSlots = getRemainingSlots(auction, masterId);
    if (balance <= 0 || remainingSlots <= 0) return 0;

    const reserveForFuturePurchases = Math.max(0, remainingSlots - 1);
    return Math.max(0, balance - reserveForFuturePurchases);
}

export function getMinimumBidForRound(round: RoundState, masterId: Master["id"]): number {
    return round.nominatedById === masterId ? 1 : 0;
}

export function getEligibleMasterIdsForRound(auction: Auction, round: RoundState): Master["id"][] {
    return Array.from(auction.masters.keys()).filter((masterId) => {
        if (getRemainingSlots(auction, masterId) <= 0) return false;
        return computeMaxBidAllowed(auction, masterId) >= getMinimumBidForRound(round, masterId);
    });
}

export function areAllBidsReceived(auction: Auction, round: RoundState): boolean {
    return getEligibleMasterIdsForRound(auction, round).every((masterId) => round.bids.has(masterId));
}

export function autoSubmitMissingBids(auction: Auction, round: RoundState, submittedAt = Date.now()): void {
    for (const masterId of getEligibleMasterIdsForRound(auction, round)) {
        if (round.bids.has(masterId)) continue;
        const bid: Bid = {
            amount: getMinimumBidForRound(round, masterId),
            isAuto: true,
            submittedAt,
        };
        round.bids.set(masterId, bid);
    }
}

export function getRoundWinner(round: RoundState): RoundWinner | null {
    const bids = Array.from(round.bids.entries());
    if (bids.length === 0) return null;

    const highestBid = Math.max(...bids.map(([, bid]) => bid.amount));
    const tiedMasterIds = new Set(bids.filter(([, bid]) => bid.amount === highestBid).map(([masterId]) => masterId));
    const winnerId =
        round.priorityOrder.find((masterId) => tiedMasterIds.has(masterId)) ??
        bids.find(([, bid]) => bid.amount === highestBid)?.[0];

    return winnerId ? { winnerId, winningBid: highestBid } : null;
}

export function getOwnerId(auction: Auction, slaveId: string): Master["id"] | null {
    if (!auction.state) return null;
    for (const [masterId, slaveIds] of auction.state.purchases.entries()) {
        if (slaveIds.includes(slaveId)) return masterId;
    }
    return null;
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

export function getPriorityOrderForNextRound(auction: Auction): Master["id"][] {
    if (!auction.rules) return [];

    let nextOrder: Master["id"][];
    if (auction.nextRoundPriorityOrder) {
        nextOrder = [...auction.nextRoundPriorityOrder];
    } else if (auction.rules.priorityType === "fixed" || !auction.lastRoundState) {
        nextOrder = [...auction.rules.startingPriorityOrder];
    } else {
        nextOrder = rotatePriorityOrder(auction.lastRoundState.priorityOrder);
    }

    return auction.rules.priorityType === "rotating" ? compactInactiveMasters(auction, nextOrder) : nextOrder;
}

export function getVisiblePriorityOrder(auction: Auction, priorityOrder: Master["id"][]): Master["id"][] {
    return priorityOrder.filter((masterId) => getRemainingSlots(auction, masterId) > 0);
}

export function getNextNominatorId(auction: Auction, currentNominatorId?: Master["id"]): Master["id"] | null {
    const order = auction.rules?.startingPriorityOrder ?? [];
    const eligible = order.filter((masterId) => getRemainingSlots(auction, masterId) > 0);
    if (eligible.length === 0) return null;
    if (eligible.length === 1) return eligible[0]!;
    if (!currentNominatorId) return eligible[0]!;

    const currentIndex = order.indexOf(currentNominatorId);
    const startIndex = currentIndex === -1 ? -1 : currentIndex;
    for (let offset = 1; offset <= order.length; offset += 1) {
        const candidateId = order[(startIndex + offset + order.length) % order.length];
        if (!candidateId) continue;
        if (candidateId !== currentNominatorId && getRemainingSlots(auction, candidateId) > 0) {
            return candidateId;
        }
    }

    return eligible.find((masterId) => masterId !== currentNominatorId) ?? eligible[0]!;
}

export function getNominationType(auction: Auction): NominationType {
    return auction.rules?.nominationType ?? "manual";
}

export function getNominationCommandMismatch(
    auction: Auction,
    command: NominationType,
): "use-manual" | "use-random" | null {
    const nominationType = getNominationType(auction);
    if (command === "manual" && nominationType === "random") return "use-random";
    if (command === "random" && nominationType === "manual") return "use-manual";
    return null;
}

export function getUnpurchasedSlaves(auction: Auction): Slave[] {
    return Array.from(auction.slaves.values()).filter((slave) => getOwnerId(auction, slave.id) === null);
}

export function pickRandomUnpurchasedSlave(auction: Auction): Slave | null {
    const remaining = getUnpurchasedSlaves(auction);
    if (remaining.length === 0) return null;
    return remaining[randomInt(remaining.length)] ?? null;
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

export function isAuctionSoldOut(auction: Auction): boolean {
    if (!auction.state) return false;
    let soldCount = 0;
    for (const slaveIds of auction.state.purchases.values()) {
        soldCount += slaveIds.length;
    }
    return soldCount >= auction.slaves.size;
}
