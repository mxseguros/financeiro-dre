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
        // Redesenho UX (spec-redesenho-ux.md §1.1): seleção (chip, aba, rádio escolhidos).
        sel: {
          DEFAULT: '#1d4ed8',   // borda
          bg:      '#eff6ff',   // fundo
          text:    '#1e3a8a',   // texto
        },
        // Cor do banco: só no ponto/ícone, nunca em texto.
        itau:      '#ec7000',
        santander: '#cc0000',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
