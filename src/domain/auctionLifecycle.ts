import type { Auction, AuctionRules, Master } from "../database/auctionStore.js";
import { discardActiveRound } from "./roundActivity.js";
import { rememberNextNominator } from "./nomination.js";
import type { BiddingStyle } from "../bidding/style.js";

export type StartAuctionInput = {
    channelId: string;
    startingBudget: number;
    roundDurationMs: number;
    maxSlavesPerMaster: number;
    priorityType: AuctionRules["priorityType"];
    nominationType?: AuctionRules["nominationType"];
    startingPriorityOrder: Master["id"][];
    startedAt?: number;
    biddingStyle?: BiddingStyle;
};

export function initializeAuction(auction: Auction, input: StartAuctionInput): void {
    if (auction.status !== "INIT") {
        throw new Error("Only an auction in its initial state can be started.");
    }

    discardActiveRound(auction);
    delete auction.lastRoundState;
    delete auction.nextRoundPriorityOrder;
    delete auction.nextNominatorId;
    auction.biddingStyle = input.biddingStyle ?? "sealed";
    auction.channelId = input.channelId;
    auction.status = "LIVE";
    auction.rules = {
        startingBudget: input.startingBudget,
        roundDurationMs: input.roundDurationMs,
        maxSlavesPerMaster: input.maxSlavesPerMaster,
        priorityType: input.priorityType,
        nominationType: input.nominationType ?? "manual",
        startingPriorityOrder: [...input.startingPriorityOrder],
    };
    auction.state = {
        startedAt: input.startedAt ?? Date.now(),
        balances: new Map(Array.from(auction.masters.keys()).map((masterId) => [masterId, input.startingBudget])),
        purchases: new Map(Array.from(auction.masters.keys()).map((masterId) => [masterId, []])),
    };
    rememberNextNominator(auction);
}

export function resetAuctionState(auction: Auction): void {
    discardActiveRound(auction);
    delete auction.lastRoundState;
    delete auction.nextRoundPriorityOrder;
    delete auction.nextNominatorId;
    delete auction.biddingStyle;
    delete auction.state;
    delete auction.rules;
    auction.channelId = null;
    auction.status = "INIT";
}
