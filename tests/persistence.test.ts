import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
    CURRENT_STATE_VERSION,
    JsonFilePersistence,
    type PersistedApplicationState,
} from "../src/database/jsonFilePersistence.js";

const temporaryDirectories: string[] = [];

function createPersistence(): JsonFilePersistence {
    const directory = mkdtempSync(join(tmpdir(), "auction-bot-test-"));
    temporaryDirectories.push(directory);
    return new JsonFilePersistence(join(directory, "state.json"));
}

function state(label: string): PersistedApplicationState {
    return {
        version: CURRENT_STATE_VERSION,
        guildConfigs: { label },
        auctions: { label },
    };
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("saves and loads one versioned state document", () => {
    const persistence = createPersistence();
    const expected = state("current");
    persistence.save(expected);

    assert.deepEqual(persistence.load(), expected);
    const onDisk = JSON.parse(readFileSync(persistence.filePath, "utf8")) as unknown;
    assert.deepEqual(onDisk, expected);
});

test("recovers the last known good state when the primary file is corrupt", () => {
    const persistence = createPersistence();
    const first = state("first");
    persistence.save(first);
    persistence.save(state("second"));
    writeFileSync(persistence.filePath, "{not-json", "utf8");

    assert.deepEqual(persistence.load(), first);
});

test("does not silently replace an invalid database with empty state", () => {
    const persistence = createPersistence();
    writeFileSync(persistence.filePath, "{not-json", "utf8");

    assert.throws(() => persistence.load(), /Could not load persisted state/);
});

test("overwrites an existing state file without losing the previous backup", () => {
    const persistence = createPersistence();
    persistence.save(state("first"));
    persistence.save(state("second"));

    assert.deepEqual(persistence.load(), state("second"));
    assert.deepEqual(JSON.parse(readFileSync(persistence.backupPath, "utf8")), state("first"));
});

test("loads the former nested-string state format for migration", () => {
    const persistence = createPersistence();
    writeFileSync(
        persistence.filePath,
        JSON.stringify({
            guildConfigs: JSON.stringify({ guild: { adminRoleId: "role" } }),
            auctions: JSON.stringify({ guild: {} }),
        }),
        "utf8",
    );

    assert.deepEqual(persistence.load(), {
        version: CURRENT_STATE_VERSION,
        guildConfigs: { guild: { adminRoleId: "role" } },
        auctions: { guild: {} },
    });
});
