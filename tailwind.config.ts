import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
        display: ['Sora', 'sans-serif']
      },
      colors: {
        brand: {
          primary: '#0F0F1F',
          secondary: '#4B16B6',
          secondaryStrong: '#3E119B',
          accent: '#6D28E0',
          lilac: '#A779FF',
          light: '#F3EDFF',
          slate: '#3B4255',
          success: '#12805C',
          warning: '#B7791F',
          danger: '#C2413A',
          info: '#4B16B6'
        }
      },
      borderRadius: {
        lg: '0.5rem',
        xl: '0.5rem',
        '2xl': '0.5rem'
      },
      boxShadow: {
        soft: '0 12px 30px rgba(15, 15, 31, 0.08)',
        card: '0 18px 45px rgba(15, 15, 31, 0.22)'
      },
      backgroundImage: {
        'hero-mesh':
          'linear-gradient(135deg, #0F0F1F 0%, #241064 50%, #4B16B6 100%)'
      }
    }
  },
  plugins: []
} satisfies Config;
