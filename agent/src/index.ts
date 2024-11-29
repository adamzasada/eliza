import { SqliteDatabaseAdapter } from "@ai16z/adapter-sqlite";
import { DirectClientInterface } from "@ai16z/client-direct";
import {
    AgentRuntime,
    CacheManager,
    Character,
    DbCacheAdapter,
    FsCacheAdapter,
    IAgentRuntime,
    ICacheManager,
    IDatabaseAdapter,
    IDatabaseCacheAdapter,
    ModelProviderName,
    defaultCharacter,
    elizaLogger,
    settings,
    stringToUuid,
    validateCharacterConfig,
} from "@ai16z/eliza";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import yargs from "yargs";

declare global {
    interface ImportMeta {
        url: string;
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function initializeDatabase(dataDir: string): IDatabaseAdapter & IDatabaseCacheAdapter {
    const filePath = process.env.SQLITE_FILE ?? path.resolve(dataDir, "db.sqlite");
    return new SqliteDatabaseAdapter(new Database(filePath)) as IDatabaseAdapter & IDatabaseCacheAdapter;
}

export async function initializeCacheManager(
    db: IDatabaseAdapter & IDatabaseCacheAdapter,
    character: Character
): Promise<ICacheManager> {
    const agentId = stringToUuid(character.id || "default");
    return new CacheManager(new DbCacheAdapter(db, agentId));
}

export async function initializeClients(
    character: Character,
    runtime: IAgentRuntime
) {
    const clients = [];
    const clientTypes = ["direct"]; // Hardcode to direct client only

    if (clientTypes.includes("direct")) {
        clients.push(await DirectClientInterface.start(runtime));
    }

    return clients;
}

export async function initializeRuntime(
    db: IDatabaseAdapter & IDatabaseCacheAdapter,
    character: Character
): Promise<IAgentRuntime> {
    const cacheManager = await initializeCacheManager(db, character);
    const token = character.settings?.secrets?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    
    if (!token) {
        throw new Error("No OpenAI API key found in character settings or environment");
    }

    const agentId = stringToUuid(character.id || "default");

    return new AgentRuntime({
        databaseAdapter: db,
        cacheManager,
        character,
        plugins: [],
        providers: [],
        token,
        modelProvider: ModelProviderName.OPENAI,
        agentId,
    });
}

export function parseArguments(): {
    character?: string;
    characters?: string;
} {
    try {
        return yargs(process.argv.slice(2))
            .option("character", {
                type: "string",
                description: "Path to the character JSON file",
            })
            .option("characters", {
                type: "string",
                description:
                    "Comma separated list of paths to character JSON files",
            })
            .parseSync();
    } catch (error) {
        elizaLogger.error("Error parsing arguments:", error);
        return {};
    }
}

function tryLoadFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, "utf8");
    } catch (e) {
        return null;
    }
}

export async function loadCharacters(
    charactersArg: string
): Promise<Character[]> {
    let characterPaths = charactersArg
        ?.split(",")
        .map((filePath) => filePath.trim());
    const loadedCharacters: Character[] = [];

    if (characterPaths?.length > 0) {
        for (const characterPath of characterPaths) {
            let content = null;
            let resolvedPath = "";

            // Try different path resolutions in order
            const pathsToTry = [
                characterPath,
                path.resolve(process.cwd(), characterPath),
                path.resolve(__dirname, characterPath),
                path.resolve(
                    __dirname,
                    "../characters",
                    path.basename(characterPath)
                ),
                path.resolve(
                    __dirname,
                    "../../characters",
                    path.basename(characterPath)
                ),
            ];

            for (const tryPath of pathsToTry) {
                content = tryLoadFile(tryPath);
                if (content !== null) {
                    resolvedPath = tryPath;
                    break;
                }
            }

            if (content === null) {
                elizaLogger.error(
                    `Error loading character from ${characterPath}: File not found in any of the expected locations`
                );
                elizaLogger.error("Tried the following paths:");
                pathsToTry.forEach((p) => elizaLogger.error(` - ${p}`));
                process.exit(1);
            }

            try {
                const character = JSON.parse(content) as Character;
                validateCharacterConfig(character);
                loadedCharacters.push(character);
                elizaLogger.info(
                    `Successfully loaded character from: ${resolvedPath}`
                );
            } catch (e) {
                elizaLogger.error(
                    `Error parsing character from ${resolvedPath}: ${e}`
                );
                process.exit(1);
            }
        }
    }

    if (loadedCharacters.length === 0) {
        elizaLogger.info("No characters found, using default character");
        loadedCharacters.push(defaultCharacter);
    }

    return loadedCharacters;
}

export async function startAgent(character: Character, directClient: any) {
    let db: (IDatabaseAdapter & IDatabaseCacheAdapter) | undefined;
    try {
        const baseDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
        const agentId = stringToUuid(character.id || "default");
        const cacheDir = path.resolve(baseDir, agentId, "cache");
        fs.mkdirSync(cacheDir, { recursive: true });

        db = initializeDatabase(baseDir);
        const runtime = await initializeRuntime(db, character);
        const clients = await initializeClients(character, runtime);

        elizaLogger.info("Agent started successfully");
        return runtime;
    } catch (error) {
        elizaLogger.error("Error starting agent:", error);
        if (db && 'close' in db) {
            await (db as any).close();
        }
        process.exit(1);
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function handleUserInput(input: string, agentId: string) {
    try {
        console.log(`User: ${input}`);
        // Add your message handling logic here
    } catch (error) {
        elizaLogger.error("Error handling user input:", error);
    }
}

async function gracefulExit() {
    elizaLogger.log("Terminating and cleaning up resources...");
    rl.close();
    process.exit(0);
}

rl.on("SIGINT", gracefulExit);
rl.on("SIGTERM", gracefulExit);

// Main execution
const args = parseArguments();
if (args.character) {
    const characters = await loadCharacters(args.character);
    for (const character of characters) {
        await startAgent(character, null);
    }
}
