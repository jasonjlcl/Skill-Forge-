/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#070a12',
        foreground: '#e2e8f0',
        card: '#0b1323',
        border: '#243047',
        primary: '#22d3ee',
        'primary-foreground': '#020617',
        muted: '#1e293b',
        accent: '#a78bfa',
      },
      boxShadow: {
        glass: '0 35px 90px -60px rgba(34, 211, 238, 0.55)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 240ms ease-out',
      },
    },
  },
  plugins: [],
};


