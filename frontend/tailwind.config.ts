import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // `navy` vira objeto para ganhar `navy-DEFAULT`/`navy-light`/`navy-hover`
        // sem quebrar nenhuma classe existente: `bg-navy` resolve para DEFAULT e
        // `bg-navy-light` / `bg-navy-hover` continuam com o mesmo nome de antes.
        navy: {
          DEFAULT: '#071934',
          light:   '#0E2444',
          hover:   '#132d55',
        },
        beige: '#B5A882',
        // Fundo da aplicação — hoje repetido como #F0F2F5 em globals.css e nos layouts.
        canvas: '#F0F2F5',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
