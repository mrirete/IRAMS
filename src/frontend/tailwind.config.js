/** @type {import('tailwindcss').Config} */
// ─────────────────────────────────────────────────────────────────────────────
// Tailwind v4 is configured CSS-first via the `@theme` block in src/index.css,
// which is the SINGLE SOURCE OF TRUTH for colors, breakpoints, radius, elevation,
// and fonts. This file is NOT loaded (no `@config` directive references it) and is
// kept only as a content-glob reference / documentation anchor.
//
// Do NOT add a `colors` block here — it silently conflicts with `@theme`.
// Add design tokens to the `@theme` block in src/index.css instead.
// ─────────────────────────────────────────────────────────────────────────────
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {},
    },
    plugins: [],
}
