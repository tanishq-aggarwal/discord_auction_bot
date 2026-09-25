import type { Auction, Master, Slave } from "../database/auctionStore.js";
import { isAuctionSoldOut } from "./economy.js";

export function recordPurchase(auction: Auction, winnerId: Master["id"], slaveId: Slave["id"], amount: number): void {
    if (!auction.state) {
        throw new Error("Cannot record a purchase without auction state.");
    }
    const purchases = auction.state.purchases.get(winnerId);
    const balance = auction.state.balances.get(winnerId);
    if (!purchases || balance === undefined) {
        throw new Error("The winning master is missing from auction state.");
    }
    if (purchases.includes(slaveId)) {
        throw new Error("The nominated slave is already owned by the winner.");
    }
    purchases.push(slaveId);
    auction.state.balances.set(winnerId, balance - amount);
}

export function refundPurchase(
    auction: Auction,
    winnerId: Master["id"],
    slaveId: Slave["id"],
    amount: number,
): boolean {
    if (!auction.state) {
        throw new Error("Cannot undo a purchase without auction state.");
    }
    const purchases = auction.state.purchases.get(winnerId);
    if (!purchases) return false;
    const nomineeIndex = purchases.lastIndexOf(slaveId);
    if (nomineeIndex === -1) return false;

    purchases.splice(nomineeIndex, 1);
    const currentBalance = auction.state.balances.get(winnerId) ?? 0;
    auction.state.balances.set(winnerId, currentBalance + amount);
    return true;
}

export function closeIfSoldOut(auction: Auction): void {
    if (!auction.state || !isAuctionSoldOut(auction)) return;
    auction.status = "CLOSED";
    auction.state.endedAt = Date.now();
}

export function reopenAuction(auction: Auction): void {
    if (auction.status !== "CLOSED" || !auction.state) return;
    auction.status = "LIVE";
    delete auction.state.endedAt;
}
