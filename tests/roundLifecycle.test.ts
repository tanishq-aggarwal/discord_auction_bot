import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { isSealedRound, type SealedRoundState } from "../src/bidding/sealed/types.js";
import {
    beginSealedRound,
    clearSealedRound,
    finalizeSealedRound,
    undoSealedRound,
} from "../src/bidding/sealed/roundLifecycle.js";
import {
    getNextObligatedMasterId,
    getPriorityOrderForNextRound,
    getRoundWinner,
    getVisiblePriorityOrder,
} from "../src/bidding/sealed/rules.js";
import type { Auction } from "../src/database/auctionStore.js";
import { AuctionStore } from "../src/database/auctionStore.js";
import { initializeAuction, resetAuctionState } from "../src/domain/auctionLifecycle.js";
import { computeMaxBidAllowed } from "../src/domain/economy.js";
import {
    getNextNominatorId,
    getNominationCommandMismatch,
    getNominationType,
    getUnpurchasedSlaves,
    pickRandomUnpurchasedSlave,
} from "../src/domain/nomination.js";

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

function addBid(round: SealedRoundState, masterId: string, amount: number): void {
    round.bids.set(masterId, { amount, isAuto: false, submittedAt: 3 });
}

test("beginRound uses an optional per-round duration instead of the auction default", () => {
    const auction = createAuction();
    const round = beginSealedRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 1_000,
        roundDurationMs: 15_000,
    });
    assert.equal(round.deadline, 16_000);
    assert.equal(auction.rules?.roundDurationMs, 120_000);
    clearSealedRound(auction);

    assert.throws(
        () =>
            beginSealedRound(auction, {
                nomineeId: "slave-b",
                nominatedById: "master-a",
                startedAt: 1_000,
                roundDurationMs: 9_000,
            }),
        /between 10 and 300 seconds/,
    );
});

test("winner selection resolves ties with the round priority", () => {
    const auction = createAuction();
    const round = beginSealedRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    addBid(round, "master-a", 4);
    addBid(round, "master-b", 4);

    assert.deepEqual(getRoundWinner(round), { winnerId: "master-a", winningBid: 4 });
});

test("visible priority order omits masters who have finished purchasing", () => {
    const auction = createAuction();
    const round = beginSealedRound(auction, {
        nomineeId: "slave-b",
        nominatedById: "master-b",
        startedAt: 3,
    });
    auction.state!.purchases.get("master-a")!.push("slave-a", "slave-c");

    assert.deepEqual(round.priorityOrder, ["master-a", "master-b"]);
    assert.deepEqual(getVisiblePriorityOrder(auction, round.priorityOrder), ["master-b"]);
});

test("reserve math leaves one coin for every future slot", () => {
    const auction = createAuction();
    assert.equal(computeMaxBidAllowed(auction, "master-a"), 9);
    auction.state!.purchases.get("master-a")!.push("slave-a");
    auction.state!.balances.set("master-a", 4);
    assert.equal(computeMaxBidAllowed(auction, "master-a"), 4);
});

test("nomination order skips finished masters and does not repeat while others remain", () => {
    const auction: Auction = {
        id: randomUUID(),
        guildId: "guild",
        channelId: null,
        name: "nominate",
        status: "INIT",
        createdAt: 1,
        masters: new Map([
            ["master-a", { id: "master-a", tag: "a" }],
            ["master-b", { id: "master-b", tag: "b" }],
            ["master-c", { id: "master-c", tag: "c" }],
            ["master-d", { id: "master-d", tag: "d" }],
        ]),
        slaves: new Map([
            ["slave-a", { id: "slave-a", tag: "sa", specialty: "Attacker" }],
            ["slave-b", { id: "slave-b", tag: "sb", specialty: "Base Builder" }],
            ["slave-c", { id: "slave-c", tag: "sc", specialty: "All Rounder" }],
            ["slave-d", { id: "slave-d", tag: "sd", specialty: "Water Boy" }],
            ["slave-e", { id: "slave-e", tag: "se", specialty: "Attacker" }],
            ["slave-f", { id: "slave-f", tag: "sf", specialty: "Base Builder" }],
        ]),
    };
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 2,
        priorityType: "fixed",
        startingPriorityOrder: ["master-a", "master-b", "master-c", "master-d"],
        startedAt: 2,
    });

    assert.equal(getNextNominatorId(auction), "master-a");
    assert.equal(getNextNominatorId(auction, "master-a"), "master-b");

    auction.state!.purchases.set("master-b", ["slave-a", "slave-b"]);
    assert.equal(getNextNominatorId(auction, "master-a"), "master-c");
    assert.equal(getNextNominatorId(auction, "master-c"), "master-d");
    assert.notEqual(getNextNominatorId(auction, "master-c"), "master-c");

    auction.state!.purchases.set("master-d", ["slave-c", "slave-d"]);
    assert.equal(getNextNominatorId(auction, "master-c"), "master-a");
});

test("rotating priority keeps advancing after masters finish purchasing", () => {
    const auction: Auction = {
        id: randomUUID(),
        guildId: "guild",
        channelId: null,
        name: "dropout",
        status: "INIT",
        createdAt: 1,
        masters: new Map([
            ["master-a", { id: "master-a", tag: "a" }],
            ["master-b", { id: "master-b", tag: "b" }],
            ["master-c", { id: "master-c", tag: "c" }],
            ["master-d", { id: "master-d", tag: "d" }],
        ]),
        slaves: new Map([
            ["slave-a", { id: "slave-a", tag: "sa", specialty: "Attacker" }],
            ["slave-b", { id: "slave-b", tag: "sb", specialty: "Base Builder" }],
            ["slave-c", { id: "slave-c", tag: "sc", specialty: "All Rounder" }],
            ["slave-d", { id: "slave-d", tag: "sd", specialty: "Water Boy" }],
            ["slave-e", { id: "slave-e", tag: "se", specialty: "Attacker" }],
            ["slave-f", { id: "slave-f", tag: "sf", specialty: "Base Builder" }],
        ]),
    };
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 2,
        priorityType: "rotating",
        startingPriorityOrder: ["master-a", "master-b", "master-c", "master-d"],
        startedAt: 2,
    });
    auction.state!.purchases.set("master-a", ["slave-a", "slave-b"]);
    auction.state!.purchases.set("master-b", ["slave-c", "slave-d"]);
    const completedRound: SealedRoundState = {
        nomineeId: "slave-d",
        nominatedById: "master-b",
        startedAt: 3,
        deadline: 4,
        priorityOrder: ["master-a", "master-b", "master-c", "master-d"],
        bids: new Map(),
    };
    auction.lastRoundState = completedRound;

    const nextRound = beginSealedRound(auction, {
        nomineeId: "slave-e",
        nominatedById: "master-c",
        startedAt: 5,
    });
    assert.deepEqual(nextRound.priorityOrder, ["master-c", "master-d", "master-b", "master-a"]);
    assert.deepEqual(getVisiblePriorityOrder(auction, nextRound.priorityOrder), ["master-c", "master-d"]);

    addBid(nextRound, "master-c", 2);
    addBid(nextRound, "master-d", 1);
    finalizeSealedRound(auction, nextRound);

    const followingRound = beginSealedRound(auction, {
        nomineeId: "slave-f",
        nominatedById: "master-d",
        startedAt: 6,
    });
    assert.deepEqual(getVisiblePriorityOrder(auction, followingRound.priorityOrder), ["master-d", "master-c"]);
});

test("undo restores the tie priority of the undone rotating round", () => {
    const auction = createAuction();
    const firstRound = beginSealedRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    addBid(firstRound, "master-a", 2);
    addBid(firstRound, "master-b", 1);
    finalizeSealedRound(auction, firstRound);

    const secondRound = beginSealedRound(auction, {
        nomineeId: "slave-b",
        nominatedById: "master-b",
        startedAt: 4,
    });
    assert.deepEqual(secondRound.priorityOrder, ["master-b", "master-a"]);
    addBid(secondRound, "master-a", 1);
    addBid(secondRound, "master-b", 2);
    finalizeSealedRound(auction, secondRound);

    const undo = undoSealedRound(auction);
    assert.equal(undo.kind, "reverted");
    assert.deepEqual(getPriorityOrderForNextRound(auction), ["master-b", "master-a"]);
});

test("cancelling and resetting clear timers and runtime state", () => {
    const auction = createAuction();
    const round = beginSealedRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    round.timeoutHandle = setTimeout(() => undefined, 60_000);
    clearSealedRound(auction);
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
    const round = beginSealedRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
    });
    addBid(round, "master-a", 3);

    const restored = new AuctionStore();
    restored.hydrate(source.toSerializable());
    const restoredAuction = restored.getByName("guild", "restart");
    assert.ok(restoredAuction?.currentRoundState && isSealedRound(restoredAuction.currentRoundState));
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
    const first = beginSealedRound(auction, { nomineeId: "slave-a", nominatedById: "master-a" });
    addBid(first, "master-a", 2);
    addBid(first, "master-b", 1);
    finalizeSealedRound(auction, first);
    const second = beginSealedRound(auction, { nomineeId: "slave-b", nominatedById: "master-b" });
    addBid(second, "master-a", 1);

    const restored = new AuctionStore();
    restored.hydrate(source.toSerializable());
    const restoredAuction = restored.getByName("guild", "both");
    assert.equal(restoredAuction?.lastRoundState?.nomineeId, "slave-a");
    assert.ok(restoredAuction?.currentRoundState && isSealedRound(restoredAuction.currentRoundState));
    assert.equal(restoredAuction.currentRoundState.nomineeId, "slave-b");
    assert.equal(restoredAuction.currentRoundState.bids.get("master-a")?.amount, 1);
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
    const round = beginSealedRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    addBid(round, "master-a", 4);
    addBid(round, "master-b", 3);

    const cancelled = clearSealedRound(auction);
    assert.equal(cancelled, round);
    assert.equal(auction.currentRoundState, undefined);
    assert.deepEqual(auction.nextRoundPriorityOrder, ["master-a", "master-b"]);
    assert.equal(auction.state!.purchases.get("master-a")!.length, 0);
    assert.throws(() => finalizeSealedRound(auction, round), /no longer active/);

    const restarted = beginSealedRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 4,
    });
    assert.deepEqual(restarted.priorityOrder, ["master-a", "master-b"]);
});

test("reset after a completed rotating auction does not reuse stale priority", () => {
    const auction = createAuction();
    const firstRound = beginSealedRound(auction, {
        nomineeId: "slave-a",
        nominatedById: "master-a",
        startedAt: 3,
    });
    addBid(firstRound, "master-a", 2);
    addBid(firstRound, "master-b", 1);
    finalizeSealedRound(auction, firstRound);
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
    const next = beginSealedRound(auction, {
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
    const round = beginSealedRound(auction, { nomineeId: "slave-a", nominatedById: "master-a" });
    let fired = false;
    round.timeoutHandle = setTimeout(() => {
        fired = true;
    }, 60_000);
    store.delete("guild", "gone");
    assert.equal(auction.currentRoundState, undefined);
    assert.equal(round.timeoutHandle, undefined);
    assert.equal(fired, false);
});

test("initializeAuction defaults nomination type to manual", () => {
    const auction = createAuction();
    assert.equal(auction.rules?.nominationType, "manual");
    assert.equal(getNominationType(auction), "manual");
});

test("initializeAuction stores random nomination type", () => {
    const auction = createAuction();
    resetAuctionState(auction);
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 2,
        priorityType: "fixed",
        nominationType: "random",
        startingPriorityOrder: ["master-a", "master-b"],
        startedAt: 3,
    });
    assert.equal(auction.rules?.nominationType, "random");
    assert.equal(getNominationType(auction), "random");
});

test("random nomination only selects unpurchased slaves", () => {
    const auction = createAuction();
    auction.state!.purchases.get("master-a")!.push("slave-a");
    const remainingIds = new Set(getUnpurchasedSlaves(auction).map((slave) => slave.id));
    assert.deepEqual([...remainingIds].sort(), ["slave-b", "slave-c"]);

    for (let i = 0; i < 20; i += 1) {
        const slave = pickRandomUnpurchasedSlave(auction);
        assert.ok(slave);
        assert.ok(remainingIds.has(slave.id));
    }

    auction.state!.purchases.get("master-a")!.push("slave-b");
    auction.state!.purchases.get("master-b")!.push("slave-c");
    assert.equal(pickRandomUnpurchasedSlave(auction), null);
});

test("random obligated master follows the nomination cursor and skips masters who cannot bid 1", () => {
    const auction: Auction = {
        id: randomUUID(),
        guildId: "guild",
        channelId: null,
        name: "random-cursor",
        status: "INIT",
        createdAt: 1,
        masters: new Map([
            ["master-a", { id: "master-a", tag: "a" }],
            ["master-b", { id: "master-b", tag: "b" }],
            ["master-c", { id: "master-c", tag: "c" }],
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
        priorityType: "fixed",
        nominationType: "random",
        startingPriorityOrder: ["master-a", "master-b", "master-c"],
        startedAt: 2,
    });

    assert.equal(auction.nextNominatorId, "master-a");
    assert.equal(getNextObligatedMasterId(auction), "master-a");

    const first = beginSealedRound(auction, { nomineeId: "slave-a", nominatedById: "master-a", startedAt: 3 });
    addBid(first, "master-a", 2);
    addBid(first, "master-b", 0);
    addBid(first, "master-c", 0);
    finalizeSealedRound(auction, first);
    assert.equal(auction.nextNominatorId, "master-b");
    assert.equal(getNextObligatedMasterId(auction), "master-b");

    auction.state!.purchases.set("master-b", ["slave-b", "slave-c"]);
    assert.equal(getNextObligatedMasterId(auction), "master-c");

    auction.state!.purchases.set("master-b", []);
    auction.state!.balances.set("master-b", 0);
    assert.equal(getNextObligatedMasterId(auction), "master-c");

    undoSealedRound(auction);
    assert.equal(auction.nextNominatorId, "master-a");
    assert.equal(getNextObligatedMasterId(auction), "master-a");
});

test("hydration defaults missing nomination type to manual and preserves random", () => {
    const source = new AuctionStore();
    const auction = source.create("guild", "noms");
    source.addMaster("guild", "noms", "master-a", "a");
    source.addSlave("guild", "noms", "slave-a", "sa", "Water Boy");
    initializeAuction(auction, {
        channelId: "channel",
        startingBudget: 10,
        roundDurationMs: 120_000,
        maxSlavesPerMaster: 1,
        priorityType: "fixed",
        nominationType: "random",
        startingPriorityOrder: ["master-a"],
    });

    const restoredRandom = new AuctionStore();
    restoredRandom.hydrate(source.toSerializable());
    assert.equal(restoredRandom.getByName("guild", "noms")?.rules?.nominationType, "random");
    assert.equal(restoredRandom.getByName("guild", "noms")?.nextNominatorId, "master-a");

    const serialized = source.toSerializable() as unknown as {
        guild: { noms: { rules: { nominationType?: string }; nextNominatorId?: string } };
    };
    delete serialized.guild.noms.rules.nominationType;
    delete serialized.guild.noms.nextNominatorId;
    const restoredDefault = new AuctionStore();
    restoredDefault.hydrate(serialized);
    assert.equal(restoredDefault.getByName("guild", "noms")?.rules?.nominationType, "manual");
    assert.equal(restoredDefault.getByName("guild", "noms")?.nextNominatorId, "master-a");
});

test("beginRound rejects owned slaves and masters who cannot be obligated", () => {
    const auction = createAuction();
    auction.state!.purchases.get("master-a")!.push("slave-a");

    assert.throws(
        () => beginSealedRound(auction, { nomineeId: "slave-a", nominatedById: "master-b" }),
        /already owned/,
    );

    auction.state!.balances.set("master-b", 0);
    assert.throws(
        () => beginSealedRound(auction, { nomineeId: "slave-b", nominatedById: "master-b" }),
        /enough budget/,
    );
});

test("each start-next command is rejected when the auction uses the other nomination type", () => {
    const auction = createAuction();
    assert.equal(getNominationCommandMismatch(auction, "random"), "use-manual");
    assert.equal(getNominationCommandMismatch(auction, "manual"), null);

    auction.rules!.nominationType = "random";
    assert.equal(getNominationCommandMismatch(auction, "manual"), "use-random");
    assert.equal(getNominationCommandMismatch(auction, "random"), null);
});
