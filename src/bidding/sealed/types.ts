import type { Master } from "../../database/auctionStore.js";
import type { RoundActivity } from "../../domain/roundActivity.js";
import type { epochMilliseconds } from "../../utils/common.js";

export type SealedBid = {
    amount: number;
    isAuto: boolean;
    submittedAt: epochMilliseconds;
};

export type SealedRoundState = RoundActivity & {
    startedAt: epochMilliseconds;
    deadline: epochMilliseconds;
    priorityOrder: Master["id"][];
    bids: Map<Master["id"], SealedBid>;
};

export type SealedRoundWinner = {
    winnerId: Master["id"];
    winningBid: number;
};

export function isSealedRound(round: RoundActivity): round is SealedRoundState {
    return "bids" in round && round.bids instanceof Map && "priorityOrder" in round && "deadline" in round;
}
