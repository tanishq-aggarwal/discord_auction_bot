import { randomInt } from "node:crypto";
import type { Auction, Master, NominationType, Slave } from "../database/auctionStore.js";
import { getRemainingSlots } from "./economy.js";

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

export function rememberNextNominator(auction: Auction, currentNominatorId?: Master["id"]): void {
    const nextNominatorId = getNextNominatorId(auction, currentNominatorId);
    if (nextNominatorId) auction.nextNominatorId = nextNominatorId;
    else delete auction.nextNominatorId;
}

export function restoreNominatorCursor(auction: Auction, nominatedById?: Master["id"]): void {
    if (nominatedById) auction.nextNominatorId = nominatedById;
    else delete auction.nextNominatorId;
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

export function describeNominationCommandMismatch(auction: Auction, command: NominationType): string | null {
    const mismatch = getNominationCommandMismatch(auction, command);
    if (mismatch === "use-random") {
        return `Auction **${auction.name}** uses random nomination. Use \`/auction start-next-random-round\` instead.`;
    }
    if (mismatch === "use-manual") {
        return `Auction **${auction.name}** uses manual nomination. Use \`/auction start-next-round\` instead.`;
    }
    return null;
}

export function getUnpurchasedSlaves(auction: Auction): Slave[] {
    const owned = new Set<string>();
    if (auction.state) {
        for (const slaveIds of auction.state.purchases.values()) {
            for (const slaveId of slaveIds) owned.add(slaveId);
        }
    }
    return Array.from(auction.slaves.values()).filter((slave) => !owned.has(slave.id));
}

export function pickRandomUnpurchasedSlave(auction: Auction): Slave | null {
    const remaining = getUnpurchasedSlaves(auction);
    if (remaining.length === 0) return null;
    return remaining[randomInt(remaining.length)] ?? null;
}
