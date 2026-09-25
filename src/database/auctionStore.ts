import { randomUUID, type UUID } from "node:crypto";
import { hydrateSealedRound, serializeSealedRound } from "../bidding/sealed/persistence.js";
import { readBiddingStyle, type BiddingStyle } from "../bidding/style.js";
import { getNextNominatorId } from "../domain/nomination.js";
import { discardActiveRound, type RoundActivity } from "../domain/roundActivity.js";
import { isSlaveSpecialty, type SlaveSpecialty } from "../domain/specialties.js";
import type { epochMilliseconds, milliseconds } from "../utils/common.js";

export type AuctionStatus = "INIT" | "LIVE" | "CLOSED";

export type NominationType = "manual" | "random";

export type AuctionRules = {
    startingBudget: number;
    roundDurationMs: milliseconds;
    maxSlavesPerMaster: number;
    priorityType: "fixed" | "rotating";
    nominationType: NominationType;
    startingPriorityOrder: Master["id"][];
};

export type AuctionState = {
    startedAt: epochMilliseconds;
    endedAt?: epochMilliseconds;
    balances: Map<Master["id"], number>;
    purchases: Map<Master["id"], Slave["id"][]>;
};

export type Auction = {
    id: UUID;
    guildId: string;
    channelId: string | null;
    name: string;
    status: AuctionStatus;
    createdAt: epochMilliseconds;

    slaves: Map<Slave["id"], Slave>;
    masters: Map<Master["id"], Master>;

    /** Gets set when auction is started */
    rules?: AuctionRules;
    /** Gets set when auction is started. Sealed bidding is the only style implemented today. */
    biddingStyle?: BiddingStyle;
    /** Gets set when auction is started */
    state?: AuctionState;
    /** Gets set whenever a round is started. Style-specific fields live on the round object. */
    currentRoundState?: RoundActivity;
    lastRoundState?: RoundActivity;
    /** Sealed bidding only. Replays the same tie priority after a cancelled or undone round. */
    nextRoundPriorityOrder?: Master["id"][];
    /** Next master in starting-order nomination, used for announcements and random obligation. */
    nextNominatorId?: Master["id"];
};

export type DiscordUser = {
    tag: string;
    id: string;
};
export type Master = DiscordUser;
export type Slave = DiscordUser & {
    specialty: SlaveSpecialty;
};

type SerializableAuctionState = Omit<AuctionState, "balances" | "purchases"> & {
    balances: Array<[Master["id"], number]>;
    purchases: Array<[Master["id"], Slave["id"][]]>;
};

type SerializableAuction = Omit<Auction, "slaves" | "masters" | "state" | "currentRoundState" | "lastRoundState"> & {
    slaves: Array<[Slave["id"], Slave]>;
    masters: Array<[Master["id"], Master]>;
    state?: SerializableAuctionState;
    currentRoundState?: ReturnType<typeof serializeSealedRound>;
    lastRoundState?: ReturnType<typeof serializeSealedRound>;
};

type SerializableAuctionsByGuild = Record<Auction["guildId"], Record<Auction["name"], SerializableAuction>>;

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

function readEntityEntries<T extends DiscordUser>(
    value: unknown,
    label: string,
    validateExtra: (entity: Record<string, unknown>) => boolean,
): Array<[string, T]> {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array.`);
    }

    return value.map((entry, index) => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isRecord(entry[1])) {
            throw new Error(`${label}[${index}] is invalid.`);
        }
        const entity = entry[1];
        if (
            typeof entity.id !== "string" ||
            typeof entity.tag !== "string" ||
            entity.id !== entry[0] ||
            !validateExtra(entity)
        ) {
            throw new Error(`${label}[${index}] contains an invalid entity.`);
        }
        return [entry[0], entity as T];
    });
}

export class AuctionStore {
    /**
     * {
     *   guild1Id: { auction1Name: auction1, auction2Name: auction2, ... },
     *   guild2Id: { auction1Name: auction1, auction2Name: auction2, ... },
     *   ...
     * }
     */
    private byGuildId: Map<Auction["guildId"], Map<Auction["name"], Auction>> = new Map();

    create(guildId: string, auctionName: string): Auction {
        let guildMap = this.byGuildId.get(guildId);
        if (!guildMap) {
            guildMap = new Map<string, Auction>();
            this.byGuildId.set(guildId, guildMap);
        }

        if (guildMap.has(auctionName)) {
            throw new Error(`Auction **${auctionName}** already exists in this server.`);
        }

        const auction: Auction = {
            id: randomUUID(),
            name: auctionName,
            guildId,
            channelId: null,
            createdAt: Date.now(),
            status: "INIT",
            slaves: new Map(),
            masters: new Map(),
        };

        guildMap.set(auction.name, auction);
        return auction;
    }

    getById(auctionId: string): Auction | undefined {
        for (const guildMap of this.byGuildId.values()) {
            for (const auction of guildMap.values()) {
                if (auction.id === auctionId) return auction;
            }
        }
    }

    getByName(guildId: string, auctionName: string): Auction | undefined {
        const guildMap = this.byGuildId.get(guildId);
        if (!guildMap) return undefined;
        return guildMap.get(auctionName);
    }

    listAll(): Auction[] {
        return Array.from(this.byGuildId.values()).flatMap((guildMap) => Array.from(guildMap.values()));
    }

    addSlave(
        guildId: string,
        auctionName: string,
        userId: string,
        userTag: string,
        specialty: Slave["specialty"],
    ): Auction {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === "LIVE")
            throw new Error("Cannot modify auction pool/participants after it has already started.");
        else if (auction.status === "CLOSED") throw new Error("This auction is already over.");

        if (auction.masters.has(userId)) {
            throw new Error(
                "That user is currently a master, and therefore cannot be enslaved.\nDemote them first using the `/auction remove-master` command.",
            );
        }

        if (auction.slaves.has(userId)) {
            throw new Error("That user is already in the slave pool.");
        }

        auction.slaves.set(userId, { tag: userTag, id: userId, specialty });
        return auction;
    }

    addMaster(guildId: string, auctionName: string, userId: string, userTag: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === "LIVE")
            throw new Error("Cannot modify auction pool/participants after it has already started.");
        else if (auction.status === "CLOSED") throw new Error("This auction is already over.");

        if (auction.slaves.has(userId)) {
            throw new Error(
                "That user is currently enslaved, and therefore cannot be added as a master.\nFree them first using the `/auction remove-slave` command.",
            );
        }

        if (auction.masters.has(userId)) {
            throw new Error("That user is already a master.");
        }

        auction.masters.set(userId, { tag: userTag, id: userId });
        return auction;
    }

    removeSlave(guildId: string, auctionName: string, userId: string, userTag: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === "LIVE")
            throw new Error("Cannot modify auction pool/participants after it has already started.");
        else if (auction.status === "CLOSED") throw new Error("This auction is already over.");

        if (!auction.slaves.has(userId)) {
            throw new Error(`**${userTag}** is already freed.`);
        }

        auction.slaves.delete(userId);
        return auction;
    }

    removeMaster(guildId: string, auctionName: string, userId: string, userTag: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === "LIVE")
            throw new Error("Cannot modify auction pool/participants after it has already started.");
        else if (auction.status === "CLOSED") throw new Error("This auction is already over.");

        if (!auction.masters.has(userId)) {
            throw new Error(`**${userTag}** is already not a master.`);
        }

        auction.masters.delete(userId);
        return auction;
    }

    listOpenAuctionNames(guildId: string): string[] {
        const guildMap = this.byGuildId.get(guildId);
        if (!guildMap) return [];
        return Array.from(guildMap.values())
            .filter((auction) => auction.status !== "CLOSED")
            .map((auction) => auction.name);
    }

    listAuctionNames(guildId: string): string[] {
        const guildMap = this.byGuildId.get(guildId);
        if (!guildMap) return [];
        return Array.from(guildMap.values()).map((auction) => auction.name);
    }

    delete(guildId: string, auctionName: string): Auction {
        const guildMap = this.byGuildId.get(guildId);
        if (!guildMap) {
            throw new Error(`Auction **${auctionName}** not found.`);
        }

        const auction = guildMap.get(auctionName);
        if (!auction) {
            throw new Error(`Auction **${auctionName}** not found.`);
        }

        discardActiveRound(auction);

        guildMap.delete(auctionName);
        if (guildMap.size === 0) {
            this.byGuildId.delete(guildId);
        }

        return auction;
    }

    updateSlaveSpecialtyAcrossGuildAuctions(
        guildId: string,
        userId: string,
        userTag: string,
        specialty: Slave["specialty"],
    ) {
        const auctions = this.byGuildId.get(guildId);
        if (!auctions) throw new Error(`No auctions found for this server.`);

        let foundSlave = false;
        for (const auction of auctions.values()) {
            if (auction.slaves.has(userId)) {
                auction.slaves.get(userId)!.specialty = specialty;
                foundSlave = true;
            }
        }
        if (!foundSlave) throw new Error(`**${userTag}** has not been enslaved in any auctions.`);
    }

    toSerializable(): SerializableAuctionsByGuild {
        const serialized: SerializableAuctionsByGuild = {};

        for (const [guildId, guildAuctions] of this.byGuildId.entries()) {
            serialized[guildId] = {};
            for (const [auctionName, auction] of guildAuctions.entries()) {
                const serializedAuction: SerializableAuction = {
                    id: auction.id,
                    guildId: auction.guildId,
                    channelId: auction.channelId,
                    name: auction.name,
                    status: auction.status,
                    createdAt: auction.createdAt,
                    slaves: Array.from(auction.slaves.entries()),
                    masters: Array.from(auction.masters.entries()),
                };
                if (auction.biddingStyle) {
                    serializedAuction.biddingStyle = auction.biddingStyle;
                }
                if (auction.rules) {
                    serializedAuction.rules = auction.rules;
                }
                if (auction.state) {
                    serializedAuction.state = {
                        ...auction.state,
                        balances: Array.from(auction.state.balances.entries()),
                        purchases: Array.from(auction.state.purchases.entries()),
                    };
                }
                if (auction.currentRoundState) {
                    serializedAuction.currentRoundState = serializeSealedRound(auction.currentRoundState);
                }
                if (auction.lastRoundState) {
                    serializedAuction.lastRoundState = serializeSealedRound(auction.lastRoundState);
                }
                if (auction.nextRoundPriorityOrder) {
                    serializedAuction.nextRoundPriorityOrder = [...auction.nextRoundPriorityOrder];
                }
                if (auction.nextNominatorId) {
                    serializedAuction.nextNominatorId = auction.nextNominatorId;
                }
                serialized[guildId][auctionName] = serializedAuction;
            }
        }

        return serialized;
    }

    hydrate(serialized: unknown): void {
        if (!isRecord(serialized)) {
            throw new Error("Persisted auctions must be an object.");
        }

        const hydratedByGuild = new Map<Auction["guildId"], Map<Auction["name"], Auction>>();
        for (const [guildId, guildAuctions] of Object.entries(serialized)) {
            if (!isRecord(guildAuctions)) {
                throw new Error(`Persisted auctions for guild "${guildId}" must be an object.`);
            }

            const guildMap = new Map<string, Auction>();
            for (const [auctionName, value] of Object.entries(guildAuctions)) {
                if (!isRecord(value)) {
                    throw new Error(`Persisted auction "${guildId}/${auctionName}" must be an object.`);
                }
                if (
                    typeof value.id !== "string" ||
                    value.guildId !== guildId ||
                    value.name !== auctionName ||
                    (value.channelId !== null && typeof value.channelId !== "string") ||
                    !isFiniteNonNegativeInteger(value.createdAt) ||
                    (value.status !== "INIT" && value.status !== "LIVE" && value.status !== "CLOSED")
                ) {
                    throw new Error(`Persisted auction "${guildId}/${auctionName}" has invalid core fields.`);
                }

                const slaveEntries = readEntityEntries<Slave>(
                    value.slaves,
                    `${guildId}/${auctionName}.slaves`,
                    (entity) => isSlaveSpecialty(entity.specialty),
                );
                const masterEntries = readEntityEntries<Master>(
                    value.masters,
                    `${guildId}/${auctionName}.masters`,
                    () => true,
                );
                if (
                    new Set(slaveEntries.map(([id]) => id)).size !== slaveEntries.length ||
                    new Set(masterEntries.map(([id]) => id)).size !== masterEntries.length ||
                    slaveEntries.some(([id]) => masterEntries.some(([masterId]) => masterId === id))
                ) {
                    throw new Error(
                        `Persisted participants for "${guildId}/${auctionName}" violate uniqueness invariants.`,
                    );
                }
                const hydratedAuction: Auction = {
                    id: value.id as UUID,
                    guildId,
                    channelId: value.channelId,
                    name: auctionName,
                    status: value.status,
                    createdAt: value.createdAt,
                    slaves: new Map(slaveEntries),
                    masters: new Map(masterEntries),
                };

                if (value.rules !== undefined) {
                    if (
                        !isRecord(value.rules) ||
                        !isFiniteNonNegativeInteger(value.rules.startingBudget) ||
                        value.rules.startingBudget < 1 ||
                        !isFiniteNonNegativeInteger(value.rules.roundDurationMs) ||
                        value.rules.roundDurationMs < 1 ||
                        !isFiniteNonNegativeInteger(value.rules.maxSlavesPerMaster) ||
                        value.rules.maxSlavesPerMaster < 1 ||
                        (value.rules.priorityType !== "fixed" && value.rules.priorityType !== "rotating") ||
                        (value.rules.nominationType !== undefined &&
                            value.rules.nominationType !== "manual" &&
                            value.rules.nominationType !== "random")
                    ) {
                        throw new Error(`Persisted rules for "${guildId}/${auctionName}" are invalid.`);
                    }
                    const startingPriorityOrder = readStringArray(
                        value.rules.startingPriorityOrder,
                        `${guildId}/${auctionName}.rules.startingPriorityOrder`,
                    );
                    if (
                        startingPriorityOrder.length !== hydratedAuction.masters.size ||
                        new Set(startingPriorityOrder).size !== startingPriorityOrder.length ||
                        startingPriorityOrder.some((masterId) => !hydratedAuction.masters.has(masterId))
                    ) {
                        throw new Error(`Persisted priority order for "${guildId}/${auctionName}" is invalid.`);
                    }
                    hydratedAuction.rules = {
                        startingBudget: value.rules.startingBudget,
                        roundDurationMs: value.rules.roundDurationMs,
                        maxSlavesPerMaster: value.rules.maxSlavesPerMaster,
                        priorityType: value.rules.priorityType,
                        nominationType: value.rules.nominationType === "random" ? "random" : "manual",
                        startingPriorityOrder,
                    };
                }

                if (value.state !== undefined) {
                    if (!isRecord(value.state) || !isFiniteNonNegativeInteger(value.state.startedAt)) {
                        throw new Error(`Persisted state for "${guildId}/${auctionName}" is invalid.`);
                    }
                    if (!Array.isArray(value.state.balances) || !Array.isArray(value.state.purchases)) {
                        throw new Error(`Persisted maps for "${guildId}/${auctionName}" are invalid.`);
                    }

                    const balances = new Map<string, number>();
                    for (const entry of value.state.balances) {
                        if (
                            !Array.isArray(entry) ||
                            entry.length !== 2 ||
                            typeof entry[0] !== "string" ||
                            !hydratedAuction.masters.has(entry[0]) ||
                            !isFiniteNonNegativeInteger(entry[1])
                        ) {
                            throw new Error(`Persisted balances for "${guildId}/${auctionName}" are invalid.`);
                        }
                        balances.set(entry[0], entry[1]);
                    }

                    const purchases = new Map<string, string[]>();
                    const purchasedSlaveIds = new Set<string>();
                    for (const entry of value.state.purchases) {
                        if (
                            !Array.isArray(entry) ||
                            entry.length !== 2 ||
                            typeof entry[0] !== "string" ||
                            !hydratedAuction.masters.has(entry[0])
                        ) {
                            throw new Error(`Persisted purchases for "${guildId}/${auctionName}" are invalid.`);
                        }
                        const slaveIds = readStringArray(entry[1], `${guildId}/${auctionName}.purchases`);
                        if (
                            slaveIds.some(
                                (slaveId) => !hydratedAuction.slaves.has(slaveId) || purchasedSlaveIds.has(slaveId),
                            )
                        ) {
                            throw new Error(
                                `Persisted purchases for "${guildId}/${auctionName}" violate ownership invariants.`,
                            );
                        }
                        slaveIds.forEach((slaveId) => purchasedSlaveIds.add(slaveId));
                        purchases.set(entry[0], slaveIds);
                    }

                    if (
                        balances.size !== hydratedAuction.masters.size ||
                        purchases.size !== hydratedAuction.masters.size
                    ) {
                        throw new Error(`Persisted state for "${guildId}/${auctionName}" is missing master entries.`);
                    }
                    hydratedAuction.state = {
                        startedAt: value.state.startedAt,
                        balances,
                        purchases,
                    };
                    if (isFiniteNonNegativeInteger(value.state.endedAt)) {
                        hydratedAuction.state.endedAt = value.state.endedAt;
                    }
                }

                if (hydratedAuction.status === "INIT") {
                    // INIT is a clean slate even if an old version persisted stale runtime fields.
                    guildMap.set(auctionName, hydratedAuction);
                    continue;
                }
                if (!hydratedAuction.rules || !hydratedAuction.state || !hydratedAuction.channelId) {
                    throw new Error(
                        `Active auction "${guildId}/${auctionName}" is missing rules, state, or channel data.`,
                    );
                }

                hydratedAuction.biddingStyle = readBiddingStyle(value.biddingStyle);
                if (value.lastRoundState !== undefined) {
                    hydratedAuction.lastRoundState = hydrateSealedRound(
                        value.lastRoundState,
                        hydratedAuction,
                        `${guildId}/${auctionName}.lastRoundState`,
                    );
                }
                if (value.currentRoundState !== undefined) {
                    hydratedAuction.currentRoundState = hydrateSealedRound(
                        value.currentRoundState,
                        hydratedAuction,
                        `${guildId}/${auctionName}.currentRoundState`,
                    );
                }
                if (value.nextRoundPriorityOrder !== undefined) {
                    const nextOrder = readStringArray(
                        value.nextRoundPriorityOrder,
                        `${guildId}/${auctionName}.nextRoundPriorityOrder`,
                    );
                    if (nextOrder.some((masterId) => !hydratedAuction.masters.has(masterId))) {
                        throw new Error(`Persisted next-round priority for "${guildId}/${auctionName}" is invalid.`);
                    }
                    hydratedAuction.nextRoundPriorityOrder = nextOrder;
                }
                if (value.nextNominatorId !== undefined) {
                    if (
                        typeof value.nextNominatorId !== "string" ||
                        !hydratedAuction.masters.has(value.nextNominatorId)
                    ) {
                        throw new Error(`Persisted next nominator for "${guildId}/${auctionName}" is invalid.`);
                    }
                    hydratedAuction.nextNominatorId = value.nextNominatorId;
                } else {
                    const derivedNominatorId = getNextNominatorId(
                        hydratedAuction,
                        hydratedAuction.lastRoundState?.nominatedById,
                    );
                    if (derivedNominatorId) hydratedAuction.nextNominatorId = derivedNominatorId;
                }

                guildMap.set(auctionName, hydratedAuction);
            }
            hydratedByGuild.set(guildId, guildMap);
        }

        this.byGuildId = hydratedByGuild;
    }
}
