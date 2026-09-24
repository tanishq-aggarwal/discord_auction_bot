import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Auction, RoundState } from "../src/database/auctionStore.js";
import { AuctionStore } from "../src/database/auctionStore.js";
import {
    beginRound,
    clearActiveRound,
    finalizeRoundState,
    initializeAuction,
    resetAuctionState,
    undoLastRoundState,
} from "../src/domain/auctionLifecycle.js";
import { computeMaxBidAllowed, getPriorityOrderForNextRound, getRoundWinner } from "../src/domain/roundRules.js";

function createAuction(): Auction {
    const auction: Auction = {
        id: randomUUID(),
        guildId: "guild",
        channelId: null,
        name: "test",
        status: "INIT",
        createdAt: 1,
        masters: new Map([
            ["master-a", { id: "master-a", tag: "a" }],
            ["master-b", { id: "master-b", tag: "b" }],
        ]),
        slaves: new Map([
            ["slave-a", { id: "slave-a", tag: "sa", specialty: "Attacker" }],
            ["slave-b", { id: "slave-b", tag: "sb", specialty: "Base Builder" }],
            ["slave-c", { id: "slave-c", tag: "sc", specialty: "All Rounder" }],
        ]),
    };
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 2,
        priorityType: "rotating",
        startingPriorityOrder: ["master-a", "master-b"],
        startedAt: 2,
    });
    return auction;
}

function addBid(round: RoundState, masterId: string, amount: number): void {
    round.bids.set(masterId, { amount, isAuto: false, submittedAt: 3 });
}

test("winner selection resolves ties with the round priority", () => {
    const auction = createAuction();
    const round = beginRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    addBid(round, "master-a", 4);
    addBid(round, "master-b", 4);

    assert.deepEqual(getRoundWinner(round), { winnerId: "master-a", winningBid: 4 });
});

test("reserve math leaves one coin for every future slot", () => {
    const auction = createAuction();
    assert.equal(computeMaxBidAllowed(auction, "master-a"), 9);
    auction.state!.purchases.get("master-a")!.push("slave-a");
    auction.state!.balances.set("master-a", 4);
    assert.equal(computeMaxBidAllowed(auction, "master-a"), 4);
});

test("undo restores the tie priority of the undone rotating round", () => {
    const auction = createAuction();
    const firstRound = beginRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    addBid(firstRound, "master-a", 2);
    addBid(firstRound, "master-b", 1);
    finalizeRoundState(auction, firstRound);

    const secondRound = beginRound(auction, {
        nomineeId: "slave-b",
        nominatedById: "master-b",
        startedAt: 4,
    });
    assert.deepEqual(secondRound.priorityOrder, ["master-b", "master-a"]);
    addBid(secondRound, "master-a", 1);
    addBid(secondRound, "master-b", 2);
    finalizeRoundState(auction, secondRound);

    const undo = undoLastRoundState(auction);
    assert.equal(undo.kind, "reverted");
    assert.deepEqual(getPriorityOrderForNextRound(auction), ["master-b", "master-a"]);
});

test("cancelling and resetting clear timers and runtime state", () => {
    const auction = createAuction();
    const round = beginRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    round.timeoutHandle = setTimeout(() => undefined, 60_000);
    clearActiveRound(auction);
    assert.equal(auction.currentRoundState, undefined);
    assert.deepEqual(auction.nextRoundPriorityOrder, ["master-a", "master-b"]);

    auction.lastRoundState = round;
    resetAuctionState(auction);
    assert.equal(auction.status, "INIT");
    assert.equal(auction.lastRoundState, undefined);
    assert.equal(auction.nextRoundPriorityOrder, undefined);
    assert.equal(auction.rules, undefined);
    assert.equal(auction.state, undefined);
});

test("serialization restores an in-progress round as active", () => {
    const source = new AuctionStore();
    const auction = source.create("guild", "restart");
    source.addMaster("guild", "restart", "master-a", "a");
    source.addSlave("guild", "restart", "slave-a", "sa", "Water Boy");
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 1,
        priorityType: "fixed",
        startingPriorityOrder: ["master-a"],
    });
    const round = beginRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
    });
    addBid(round, "master-a", 3);

    const restored = new AuctionStore();
    restored.hydrate(source.toSerializable());
    const restoredAuction = restored.getByName("guild", "restart");
    assert.ok(restoredAuction?.currentRoundState);
    assert.equal(restoredAuction.lastRoundState, undefined);
    assert.equal(restoredAuction.currentRoundState.bids.get("master-a")?.amount, 3);
});

test("serialization keeps both the last completed round and the active round", () => {
    const source = new AuctionStore();
    const auction = source.create("guild", "both");
    source.addMaster("guild", "both", "master-a", "a");
    source.addMaster("guild", "both", "master-b", "b");
    source.addSlave("guild", "both", "slave-a", "sa", "Attacker");
    source.addSlave("guild", "both", "slave-b", "sb", "Base Builder");
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 2,
        priorityType: "rotating",
        startingPriorityOrder: ["master-a", "master-b"],
    });
    const first = beginRound(auction, { nomineeId: "slave-a", nominatedById: "master-a" });
    addBid(first, "master-a", 2);
    addBid(first, "master-b", 1);
    finalizeRoundState(auction, first);
    const second = beginRound(auction, { nomineeId: "slave-b", nominatedById: "master-b" });
    addBid(second, "master-a", 1);

    const restored = new AuctionStore();
    restored.hydrate(source.toSerializable());
    const restoredAuction = restored.getByName("guild", "both");
    assert.equal(restoredAuction?.lastRoundState?.nomineeId, "slave-a");
    assert.equal(restoredAuction?.currentRoundState?.nomineeId, "slave-b");
    assert.equal(restoredAuction?.currentRoundState?.bids.get("master-a")?.amount, 1);
    assert.deepEqual(getPriorityOrderForNextRound(restoredAuction!), ["master-b", "master-a"]);
});

test("hydration rejects corrupt auction documents instead of wiping them", () => {
    const store = new AuctionStore();
    assert.throws(
        () =>
            store.hydrate({
                guild: {
                    broken: {
                        id: "not-an-auction",
                    },
                },
            }),
        /invalid core fields/,
    );
});

test("cancelling after a bid keeps the purchase from being applied", () => {
    const auction = createAuction();
    const round = beginRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    addBid(round, "master-a", 4);
    addBid(round, "master-b", 3);

    const cancelled = clearActiveRound(auction);
    assert.equal(cancelled, round);
    assert.equal(auction.currentRoundState, undefined);
    assert.deepEqual(auction.nextRoundPriorityOrder, ["master-a", "master-b"]);
    assert.equal(auction.state!.purchases.get("master-a")!.length, 0);
    assert.throws(() => finalizeRoundState(auction, round), /no longer active/);

    const restarted = beginRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 4,
    });
    assert.deepEqual(restarted.priorityOrder, ["master-a", "master-b"]);
});

test("reset after a completed rotating auction does not reuse stale priority", () => {
    const auction = createAuction();
    const firstRound = beginRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    addBid(firstRound, "master-a", 2);
    addBid(firstRound, "master-b", 1);
    finalizeRoundState(auction, firstRound);
    resetAuctionState(auction);
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 2,
        priorityType: "rotating",
        startingPriorityOrder: ["master-a", "master-b"],
        startedAt: 5,
    });
    const next = beginRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 6,
    });
    assert.deepEqual(next.priorityOrder, ["master-a", "master-b"]);
});

test("delete clears an active timer before removing the auction", () => {
    const store = new AuctionStore();
    const auction = store.create("guild", "gone");
    store.addMaster("guild", "gone", "master-a", "a");
    store.addSlave("guild", "gone", "slave-a", "sa", "Water Boy");
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 1,
        priorityType: "fixed",
        startingPriorityOrder: ["master-a"],
    });
    const round = beginRound(auction, { nomineeId: "slave-a", nominatedById: "master-a" });
    let fired = false;
    round.timeoutHandle = setTimeout(() => {
        fired = true;
    }, 60_000);
    store.delete("guild", "gone");
    assert.equal(auction.currentRoundState, undefined);
    assert.equal(round.timeoutHandle, undefined);
    assert.equal(fired, false);
});
