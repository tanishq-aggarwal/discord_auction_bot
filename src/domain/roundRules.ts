import type { Auction, Bid, Master, RoundState } from "../database/auctionStore.js";

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

export function getPriorityOrderForNextRound(auction: Auction): Master["id"][] {
    if (!auction.rules) return [];
    if (auction.nextRoundPriorityOrder) return [...auction.nextRoundPriorityOrder];
    if (auction.rules.priorityType === "fixed" || !auction.lastRoundState) {
        return [...auction.rules.startingPriorityOrder];
    }
    return rotatePriorityOrder(auction.lastRoundState.priorityOrder);
}

export function isAuctionSoldOut(auction: Auction): boolean {
    if (!auction.state) return false;
    let soldCount = 0;
    for (const slaveIds of auction.state.purchases.values()) {
        soldCount += slaveIds.length;
    }
    return soldCount >= auction.slaves.size;
}
