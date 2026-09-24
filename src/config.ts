export function requireEnvironmentVariable(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Required environment variable ${name} is not set.`);
    }
    return value;
}
