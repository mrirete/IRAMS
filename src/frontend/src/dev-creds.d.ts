// Vite `define` globals (see vite.config.ts):
// __DEV_ADMIN_PASSWORD__ / __DEV_TEST_PASSWORD__ — dev-server-only quick-switch
// credentials sourced from the repo-root .env.local. Production builds define ''.
declare const __DEV_ADMIN_PASSWORD__: string;
declare const __DEV_TEST_PASSWORD__: string;
