/**
 * Demo-data flag — the single switch that decides whether illustrative MOCK
 * reliability/integrity/intelligence data may be shown when the database is empty.
 *
 * WHY THIS EXISTS:
 *   The reliability hooks (useIntegrity / useIntelligence / useStrategy) were
 *   seeded with mock data as their INITIAL state and only replaced it when
 *   Supabase returned rows. On an empty production database that meant fabricated
 *   FMEAs, RCAs, corrosion readings and RUL numbers rendered as if they were real
 *   — a trust/audit landmine for a reliability product.
 *
 *   With DEMO_DATA off (the production default) those hooks start EMPTY and the
 *   pages show honest empty states. Turn it on only for sales demos / local dev.
 *
 * USAGE:
 *   .env.local (sales demo / Storybook):   VITE_DEMO_DATA=true
 *   production:                            unset  → false → real empty states
 */
export const DEMO_DATA: boolean = import.meta.env.VITE_DEMO_DATA === 'true';

/**
 * Pick the demo seed when demo mode is on, otherwise the production-safe empty value.
 *   useState(demoSeed(MOCK_CMLS, []))
 */
export function demoSeed<T>(mock: T, empty: T): T {
    return DEMO_DATA ? mock : empty;
}
