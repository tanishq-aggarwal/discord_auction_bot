import {
    closeSync,
    copyFileSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";

export const CURRENT_STATE_VERSION = 1;

export type PersistedApplicationState = {
    version: typeof CURRENT_STATE_VERSION;
    guildConfigs: unknown;
    auctions: unknown;
};

const DEFAULT_STATE_PATH = "data/auction-bot.json";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrno(error: unknown, codes: readonly string[]): boolean {
    return typeof error === "object" && error !== null && "code" in error && codes.includes(String(error.code));
}

function syncFileBestEffort(filePath: string): void {
    try {
        const descriptor = openSync(filePath, "r+");
        try {
            fsyncSync(descriptor);
        } finally {
            closeSync(descriptor);
        }
    } catch (error) {
        // Some hosts (Windows sandboxes, certain network mounts) reject fsync.
        if (isErrno(error, ["EPERM", "ENOTSUP", "EINVAL", "EBADF"])) return;
        throw error;
    }
}

function replaceFile(fromPath: string, toPath: string): void {
    try {
        renameSync(fromPath, toPath);
    } catch (error) {
        // Windows cannot always rename over an existing destination.
        if (!isErrno(error, ["EPERM", "EEXIST", "EACCES"])) throw error;
        copyFileSync(fromPath, toPath);
        rmSync(fromPath, { force: true });
    }
}

function parseLegacyJson(value: unknown, key: string): unknown {
    if (typeof value !== "string") {
        return value;
    }

    try {
        return JSON.parse(value) as unknown;
    } catch (error) {
        throw new Error(`The legacy "${key}" state is not valid JSON.`, { cause: error });
    }
}

function parseStateDocument(raw: string): PersistedApplicationState {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
        throw new Error("The persisted state root must be an object.");
    }

    if (parsed.version === CURRENT_STATE_VERSION) {
        if (!("guildConfigs" in parsed) || !("auctions" in parsed)) {
            throw new Error("The persisted state is missing required sections.");
        }
        return {
            version: CURRENT_STATE_VERSION,
            guildConfigs: parsed.guildConfigs,
            auctions: parsed.auctions,
        };
    }

    // Backward compatibility with the former key/value file where each section
    // was independently JSON-stringified.
    if ("guildConfigs" in parsed || "auctions" in parsed) {
        return {
            version: CURRENT_STATE_VERSION,
            guildConfigs: parseLegacyJson(parsed.guildConfigs ?? {}, "guildConfigs"),
            auctions: parseLegacyJson(parsed.auctions ?? {}, "auctions"),
        };
    }

    throw new Error("The persisted state has an unsupported or missing version.");
}

export class JsonFilePersistence {
    readonly filePath: string;
    readonly backupPath: string;

    constructor(statePath = process.env.STATE_PATH ?? process.env.SQLITE_PATH ?? DEFAULT_STATE_PATH) {
        const pathWithExtension = extname(statePath) ? statePath : `${statePath}.json`;
        this.filePath = isAbsolute(pathWithExtension) ? pathWithExtension : resolve(process.cwd(), pathWithExtension);
        this.backupPath = `${this.filePath}.bak`;
        mkdirSync(dirname(this.filePath), { recursive: true });
    }

    load(): PersistedApplicationState {
        if (!existsSync(this.filePath)) {
            return {
                version: CURRENT_STATE_VERSION,
                guildConfigs: {},
                auctions: {},
            };
        }

        try {
            return parseStateDocument(readFileSync(this.filePath, "utf8"));
        } catch (primaryError) {
            if (existsSync(this.backupPath)) {
                try {
                    const recovered = parseStateDocument(readFileSync(this.backupPath, "utf8"));
                    console.error(
                        `[state:recovered-from-backup] primary=${this.filePath} backup=${this.backupPath}`,
                        primaryError,
                    );
                    return recovered;
                } catch (backupError) {
                    throw new AggregateError(
                        [primaryError, backupError],
                        `Both the state file and its backup are invalid: ${this.filePath}`,
                        { cause: backupError },
                    );
                }
            }

            throw new Error(`Could not load persisted state from ${this.filePath}.`, { cause: primaryError });
        }
    }

    save(state: PersistedApplicationState): void {
        const tempPath = `${this.filePath}.${process.pid}.tmp`;
        const serialized = JSON.stringify(state);

        try {
            writeFileSync(tempPath, serialized, "utf8");
            syncFileBestEffort(tempPath);

            if (existsSync(this.filePath)) {
                copyFileSync(this.filePath, this.backupPath);
                syncFileBestEffort(this.backupPath);
            }
            replaceFile(tempPath, this.filePath);
        } finally {
            rmSync(tempPath, { force: true });
        }
    }
}
