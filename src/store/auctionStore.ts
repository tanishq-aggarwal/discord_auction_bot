import { randomUUID } from 'node:crypto';

export type AuctionStatus = 'OPEN' | 'CLOSED';

export type Auction = {
    id: string;
    guildId: string;
    channelId: string;
    name: string;
    status: AuctionStatus;
    createdByUserId: string;
    createdAt: number;
    players: Map<string, AuctionPlayer>;
    participants: Map<string, AuctionParticipant>;
};

export type AuctionPlayer = {
    userId: string;
    addedByUserId: string;
    addedAt: number;
};

export type AuctionParticipant = {
  userId: string;
  addedByUserId: string;
  addedAt: number;
};



export class AuctionStore {
    private byGuildAndName = new Map<string, Map<string, Auction>>();

    create(input: Pick<Auction, 'guildId' | 'channelId' | 'name' | 'createdByUserId'>): Auction {
        const guildMap = this.byGuildAndName.get(input.guildId) ?? new Map<string, Auction>();

        if (guildMap.has(input.name)) {
            throw new Error(`Auction **${input.name}** already exists in this server.`);
        }

        const auction: Auction = {
            ...input,
            id: randomUUID(),
            createdAt: Date.now(),
            players: new Map(),
            participants: new Map(),
            status: 'OPEN'
        };

        guildMap.set(auction.name, auction);
        this.byGuildAndName.set(input.guildId, guildMap);

        return auction;
    }

    getByName(guildId: string, name: string): Auction | undefined {
        return this.byGuildAndName.get(guildId)?.get(name);
    }

    count(guildId: string): number {
        return this.byGuildAndName.get(guildId)?.size ?? 0;
    }

    listOpenAuctionNames(guildId: string): string[] {
        const guildMap = this.byGuildAndName.get(guildId);
        if (!guildMap) return [];
        return [...guildMap.values()]
            .filter(a => a.status === 'OPEN')
            .map(a => a.name);
    }

    addPlayer(guildId: string, auctionName: string, userId: string, addedByUserId: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction "${auctionName}" not found.`);
        if (auction.status !== 'OPEN') throw new Error(`Auction "${auctionName}" is closed.`);

        if (auction.participants.has(userId)) {
            throw new Error('That user is already a participant, so they cannot be added to the player pool.');
        }
        if (auction.players.has(userId)) {
            throw new Error('That player is already in the pool.');
        }

        auction.players.set(userId, { userId, addedByUserId, addedAt: Date.now() });
        return auction;
    }

    addParticipant(guildId: string, auctionName: string, userId: string, addedByUserId: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction "${auctionName}" not found.`);
        if (auction.status !== 'OPEN') throw new Error(`Auction "${auctionName}" is closed.`);

        if (auction.players.has(userId)) {
            throw new Error('That user is already in the player pool, so they cannot be added as a participant.');
        }
        if (auction.participants.has(userId)) {
            throw new Error('That user is already a participant.');
        }

        auction.participants.set(userId, { userId, addedByUserId, addedAt: Date.now() });
        return auction;
    }

    removePlayer(guildId: string, auctionName: string, userId: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction "${auctionName}" not found.`);
        if (auction.status !== 'OPEN') throw new Error(`Auction "${auctionName}" is closed.`);

        const existed = auction.players.delete(userId);
        if (!existed) throw new Error('That user is not in the player pool.');
        return auction;
        }

    removeParticipant(guildId: string, auctionName: string, userId: string) {
        const auction = this.getByName(guildId, auctionName);
        if (!auction) throw new Error(`Auction "${auctionName}" not found.`);
        if (auction.status !== 'OPEN') throw new Error(`Auction "${auctionName}" is closed.`);

        const existed = auction.participants.delete(userId);
        if (!existed) throw new Error('That user is not a participant.');
        return auction;
    }
}
