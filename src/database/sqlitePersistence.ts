import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";

const DEFAULT_DB_PATH = "data/auction-bot.json";

type PersistedState = Record<string, string>;

export class SqlitePersistence {
    private readonly filePath: string;
    private state: PersistedState;

    constructor(dbPath = process.env.SQLITE_PATH ?? DEFAULT_DB_PATH) {
        const pathWithExtension = extname(dbPath)
            ? dbPath
            : `${dbPath}.json`;
        const resolvedPath = isAbsolute(pathWithExtension)
            ? pathWithExtension
            : resolve(process.cwd(), pathWithExtension);

        mkdirSync(dirname(resolvedPath), { recursive: true });
        this.filePath = resolvedPath;
        this.state = this.readStateFromDisk();
    }

    getJson<T>(key: string, fallback: T): T {
        const rawValue = this.state[key];
        if (!rawValue) return fallback;

        try {
            return JSON.parse(rawValue) as T;
        }
        catch (error) {
            console.error(`[sqlite:parse-error] key=${key}`, error);
            return fallback;
        }
    }

    setJson(key: string, value: unknown): void {
        this.state[key] = JSON.stringify(value);
        this.writeStateToDisk();
    }

    private readStateFromDisk(): PersistedState {
        try {
            const raw = readFileSync(this.filePath, "utf8");
            if (!raw.trim()) return {};
            const parsed = JSON.parse(raw) as unknown;
            if (!parsed || typeof parsed !== "object") return {};

            const entries = Object.entries(parsed as Record<string, unknown>)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string");

            return Object.fromEntries(entries);
        }
        catch {
            return {};
        }
    }

    private writeStateToDisk(): void {
        writeFileSync(this.filePath, JSON.stringify(this.state), "utf8");
    }
}
