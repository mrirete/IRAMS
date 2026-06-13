/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            screens: {
                'xs': '475px',
            },
            colors: {
                brand: {
                    950: '#ffffff',  // lightest — page bg fallback
                    900: '#f1f5f9',  // shell bg, sidebar bg
                    800: '#e8edf3',  // soft slate-blue sidebar
                    700: '#cbd5e1',  // borders, dividers
                    600: '#94a3b8',  // muted icons, dividers
                    500: '#64748b',  // secondary/disabled text
                    400: '#475569',  // nav text (inactive)
                    300: '#334155',  // hover text
                    200: '#1e293b',  // primary text
                    100: '#0f172a',  // headings, bold text
                    50:  '#020617',  // darkest (near black)
                },
                accent: {
                    blue: '#3b82f6',
                    cyan: '#06b6d4',
                    alert: '#ef4444',
                    warn: '#f59e0b',
                    safe: '#10b981'
                },
                relantern: {
                    50: '#FFF8E1',
                    100: '#FFECB3',
                    200: '#FFD54F',
                    300: '#FFCA28',
                    400: '#FFC107',
                    500: '#F5A623', // primary brand amber
                    600: '#E09100',
                    700: '#C67C00',
                    800: '#A66600',
                    900: '#7A4D00',
                }
            },
            fontFamily: {
                sans: ['Inter', 'Roboto', 'sans-serif'],
            }
        },
    },
    plugins: [],
}
