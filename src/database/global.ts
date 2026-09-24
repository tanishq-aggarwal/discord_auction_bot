import { AuctionStore } from "./auctionStore.js";
import { GuildConfigStore } from "./guildConfigStore.js";
import { CURRENT_STATE_VERSION, JsonFilePersistence, type PersistedApplicationState } from "./jsonFilePersistence.js";

export const guildConfigs = new GuildConfigStore();
export const auctions = new AuctionStore();
const persistence = new JsonFilePersistence();

function loadPersistentState(): void {
    const state = persistence.load();
    guildConfigs.hydrate(state.guildConfigs);
    auctions.hydrate(state.auctions);
}

export function persistState(): void {
    const state: PersistedApplicationState = {
        version: CURRENT_STATE_VERSION,
        guildConfigs: guildConfigs.toSerializable(),
        auctions: auctions.toSerializable(),
    };
    persistence.save(state);
}

loadPersistentState();
