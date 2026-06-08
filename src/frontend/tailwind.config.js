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
                    950: '#020617', // darkest slate
                    900: '#0f172a', // deep slate (sidebar/topbar bg option)
                    800: '#1e293b', // sidebar/topbar bg
                    700: '#334155', // borders, hover bg
                    600: '#475569', // muted dividers
                    500: '#64748b', // secondary icons
                    400: '#94a3b8', // nav text (inactive)
                    300: '#cbd5e1', // hover text, breadcrumb
                    200: '#e2e8f0', // primary text
                    100: '#f1f5f9', // bright text, headings
                    50: '#f8fafc', // near-white
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
