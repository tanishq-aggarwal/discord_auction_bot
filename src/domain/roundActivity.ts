import type { Auction, Master, Slave } from "../database/auctionStore.js";

/** Fields every bidding style needs in order to show, cancel, or resume a round. */
export type RoundActivity = {
    nomineeId: Slave["id"];
    nominatedById?: Master["id"];
    nomineeTag?: string;
    nomineeAvatarURL?: string;
    statusMessageId?: string;
    timeoutHandle?: NodeJS.Timeout;
};

export function discardActiveRound(auction: Auction): RoundActivity | null {
    const round = auction.currentRoundState;
    if (!round) return null;
    if (round.timeoutHandle) {
        clearTimeout(round.timeoutHandle);
        delete round.timeoutHandle;
    }
    delete auction.currentRoundState;
    return round;
}
