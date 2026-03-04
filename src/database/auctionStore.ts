import { randomUUID, type UUID } from 'node:crypto';
import type { epochMilliseconds } from '../utils/common.js';

export type AuctionStatus = 'OPEN' | 'LIVE' | 'CLOSED';
export type Bid = { amount: number; isAuto: boolean; submittedAt: number };

export type LiveRound = {
    id: string;
    playerUserId: string;
    startedAt: number;
    endsAt: number;
    bids: Map<string, Bid>;              // participantUserId -> bid
    roundMessageId?: string;
    timeoutHandle?: NodeJS.Timeout;
};

export type LiveState = {
    startingBudget: number;             // 100
    balances: Map<string, number>;      // participantUserId -> coins
    purchases: Map<string, string[]>;   // participantUserId -> list of playerUserIds
    tiePriority: string[];              // rotating list of participantUserIds
    maxPurchasesPerParticipant: number;
    round?: LiveRound;
};

export type Auction = {
    id: UUID;
    guildId: string;
    channelId: string;
    name: string;
    status: AuctionStatus;
    createdAt: epochMilliseconds;

    slaves: Map<DiscordUser["id"], DiscordUser>;
    masters: Map<DiscordUser["id"], DiscordUser>;

    live?: LiveState;
};

export type DiscordUser = {
    tag: string;
    id: string;
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

    create(guildId: string, auctionName: string, auctionChannelId: string): Auction {
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
            channelId: auctionChannelId,
            createdAt: Date.now(),
            status: 'OPEN',
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

    addSlave(guildId: string, auctionName: string, userId: string, userTag: string): Auction {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === 'LIVE') throw new Error('Cannot modify auction pool/participants after it has already started.');
        else if (auction.status === 'CLOSED') throw new Error('This auction is already over.');

        if (auction.masters.has(userId)) {
            throw new Error('That user is already a master, so they cannot be added as a slave. Remove them first using the `/auction remove-master` command.');
        }

        if (auction.slaves.has(userId)) {
            throw new Error('That user is already in the slave pool.');
        }

        auction.slaves.set(userId, { tag: userTag, id: userId });
        return auction;
    }

    addMaster(guildId: string, auctionName: string, userId: string, userTag: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction **${auctionName}** not found.`);
        if (auction.status === 'LIVE') throw new Error('Cannot modify auction pool/participants after it has already started.');
        else if (auction.status === 'CLOSED') throw new Error('This auction is already over.');

        if (auction.slaves.has(userId)) {
            throw new Error('That user is already a slave, so they cannot be added as a master. Remove them first using the `/auction remove-slave` command.');
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
            throw new Error(`**${userTag}** is already not a slave.`);
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
                    .filter(auction => auction.status === 'OPEN')
                    .map(auction => auction.name);
    }
}
