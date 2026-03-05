import { randomUUID, type UUID } from 'node:crypto';
import type { epochMilliseconds, milliseconds } from '../utils/common.js';

export type AuctionStatus = 'INIT' | 'LIVE' | 'CLOSED';

export type Bid = { amount: number; isAuto: boolean; submittedAt: epochMilliseconds };

export type RoundState = {
    nominee: Slave["id"];
    nominatedBy: Master["id"];
    startedAt: epochMilliseconds;
    deadline: epochMilliseconds;
    priorityOrder?: Master["id"][];
    bids: Map<Master["id"], Bid>;
    timeoutHandle?: NodeJS.Timeout;
};

export type AuctionRules = {
    startingBudget: number;
    roundDurationMs: milliseconds;
    maxSlavesPerMaster: number;
    priorityType: 'fixed' | 'rotating';
    startingPriorityOrder: Master["id"][];
};

export type AuctionState = {
    startedAt: epochMilliseconds;
    endedAt: epochMilliseconds;
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
    /** Gets set when auction is started */
    state?: AuctionState;
    /** Gets set whenever a round is started */
    currentRoundState?: RoundState;
};


export type DiscordUser = {
    tag: string;
    id: string;
}
export type Master = DiscordUser;
export type Slave = DiscordUser & {
    specialties?: string | undefined;
};



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
            throw new Error(`Auction **${name}** already exists in this server.`);
        }

        const auction: Auction = {
            id: randomUUID(),
            name: auctionName,
            guildId,
            channelId: null,
            createdAt: Date.now(),
            status: 'INIT',
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

    addSlave(guildId: string, auctionName: string, userId: string, userTag: string, specialties?: string): Auction {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === 'LIVE') throw new Error('Cannot modify auction pool/participants after it has already started.');
        else if (auction.status === 'CLOSED') throw new Error('This auction is already over.');

        if (auction.masters.has(userId)) {
            throw new Error('That user is currently a master, and therefore cannot be enslaved.\nDemote them first using the `/auction remove-master` command.');
        }

        if (auction.slaves.has(userId)) {
            throw new Error('That user is already in the slave pool.');
        }

        auction.slaves.set(userId, { tag: userTag, id: userId, specialties });
        return auction;
    }

    addMaster(guildId: string, auctionName: string, userId: string, userTag: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === 'LIVE') throw new Error('Cannot modify auction pool/participants after it has already started.');
        else if (auction.status === 'CLOSED') throw new Error('This auction is already over.');

        if (auction.slaves.has(userId)) {
            throw new Error('That user is currently enslaved, and therefore cannot be added as a master.\nFree them first using the `/auction remove-slave` command.');
        }

        if (auction.masters.has(userId)) {
            throw new Error('That user is already a master.');
        }

        auction.masters.set(userId, { tag: userTag, id: userId });
        return auction;
    }

    removeSlave(guildId: string, auctionName: string, userId: string, userTag: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === 'LIVE') throw new Error('Cannot modify auction pool/participants after it has already started.');
        else if (auction.status === 'CLOSED') throw new Error('This auction is already over.');

        if (!auction.slaves.has(userId)) {
            throw new Error(`**${userTag}** is already freed.`);
        }

        auction.slaves.delete(userId);
        return auction;
    }

    removeMaster(guildId: string, auctionName: string, userId: string, userTag: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === 'LIVE') throw new Error('Cannot modify auction pool/participants after it has already started.');
        else if (auction.status === 'CLOSED') throw new Error('This auction is already over.');

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
                    .filter(auction => auction.status === 'INIT')
                    .map(auction => auction.name);
    }

    updateSlaveSpecialties(guildId: string, userId: string, userTag: string, specialties: string) {
        const auctions = this.byGuildId.get(guildId);
        if (!auctions) throw new Error(`No auctions found for this server.`);

        let foundSlave = false;
        for (const auction of auctions.values()) {
            if (auction.slaves.has(userId)) {
                auction.slaves.get(userId)!.specialties = specialties;
                foundSlave = true;
            }
        }
        if (!foundSlave) throw new Error(`**${userTag}** has not been enslaved in any auctions.`);
    }
}
