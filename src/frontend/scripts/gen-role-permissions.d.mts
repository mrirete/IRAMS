/**
 * Types for the seed generator, so rolePermissionsMirror.test.ts can import it
 * without `tsc` falling back to `any`. The implementation stays .mjs because it
 * also runs as a CLI under vite-node.
 */
export declare const DEFAULT_ROLE_KEY: string;
export declare const BEGIN_MARK: string;
export declare const END_MARK: string;
export declare function migrationFile(): string;

/** Deterministic SQL seed block built from ROLE_PERMISSION_TEMPLATES. */
export declare function generateSeedSql(): string;

/** Pull the generated block out of a migration file; null if the markers are absent. */
export declare function extractSeed(sql: string): string | null;
