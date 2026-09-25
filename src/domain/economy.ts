import type { Auction, Master } from "../database/auctionStore.js";

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

export function getOwnerId(auction: Auction, slaveId: string): Master["id"] | null {
    if (!auction.state) return null;
    for (const [masterId, slaveIds] of auction.state.purchases.entries()) {
        if (slaveIds.includes(slaveId)) return masterId;
    }
    return null;
}

export function isAuctionSoldOut(auction: Auction): boolean {
    if (!auction.state) return false;
    let soldCount = 0;
    for (const slaveIds of auction.state.purchases.values()) {
        soldCount += slaveIds.length;
    }
    return soldCount >= auction.slaves.size;
}
