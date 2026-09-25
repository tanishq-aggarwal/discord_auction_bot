import type { Auction, Master } from "../../database/auctionStore.js";
import type { RoundActivity } from "../../domain/roundActivity.js";
import type { epochMilliseconds } from "../../utils/common.js";
import type { SealedBid, SealedRoundState } from "./types.js";

type SerializableSealedRound = Omit<SealedRoundState, "bids" | "timeoutHandle"> & {
    bids: Array<[Master["id"], SealedBid]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && Number.isFinite(value);
}

function readStringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error(`${label} must be an array of strings.`);
    }
    return [...value];
}

export function serializeSealedRound(round: RoundActivity): SerializableSealedRound {
    if (!("bids" in round) || !(round.bids instanceof Map) || !("priorityOrder" in round) || !("deadline" in round)) {
        throw new Error("Cannot persist a round that is not sealed bidding.");
    }
    const sealed = round as SealedRoundState;
    const persisted = { ...sealed, bids: Array.from(sealed.bids.entries()) };
    delete persisted.timeoutHandle;
    return persisted;
}

export function hydrateSealedRound(value: unknown, auction: Auction, label: string): SealedRoundState {
    if (!isRecord(value)) {
        throw new Error(`${label} must be an object.`);
    }
    if (
        typeof value.nomineeId !== "string" ||
        !auction.slaves.has(value.nomineeId) ||
        !isFiniteNonNegativeInteger(value.startedAt) ||
        !isFiniteNonNegativeInteger(value.deadline)
    ) {
        throw new Error(`${label} has invalid identity or timestamps.`);
    }
    if (
        value.nominatedById !== undefined &&
        (typeof value.nominatedById !== "string" || !auction.masters.has(value.nominatedById))
    ) {
        throw new Error(`${label} has an invalid nominator.`);
    }

    const priorityOrder = readStringArray(value.priorityOrder, `${label}.priorityOrder`);
    if (priorityOrder.some((masterId) => !auction.masters.has(masterId))) {
        throw new Error(`${label}.priorityOrder contains an unknown master.`);
    }
    if (!Array.isArray(value.bids)) {
        throw new Error(`${label}.bids must be an array.`);
    }

    const bids = new Map<Master["id"], SealedBid>();
    for (const [index, entry] of value.bids.entries()) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isRecord(entry[1])) {
            throw new Error(`${label}.bids[${index}] is invalid.`);
        }
        const [masterId, bid] = entry;
        if (
            !auction.masters.has(masterId) ||
            !isFiniteNonNegativeInteger(bid.amount) ||
            typeof bid.isAuto !== "boolean" ||
            !isFiniteNonNegativeInteger(bid.submittedAt)
        ) {
            throw new Error(`${label}.bids[${index}] contains invalid bid data.`);
        }
        bids.set(masterId, {
            amount: bid.amount,
            isAuto: bid.isAuto,
            submittedAt: bid.submittedAt as epochMilliseconds,
        });
    }

    const round: SealedRoundState = {
        nomineeId: value.nomineeId,
        startedAt: value.startedAt,
        deadline: value.deadline,
        priorityOrder,
        bids,
    };
    if (value.nominatedById !== undefined) round.nominatedById = value.nominatedById;
    if (typeof value.nomineeTag === "string") round.nomineeTag = value.nomineeTag;
    if (typeof value.nomineeAvatarURL === "string") round.nomineeAvatarURL = value.nomineeAvatarURL;
    if (typeof value.statusMessageId === "string") round.statusMessageId = value.statusMessageId;
    return round;
}
