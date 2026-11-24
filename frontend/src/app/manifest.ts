import type { MetadataRoute } from 'next'

// "Adicionar à tela inicial" (24/11/2026): o atalho abre direto a Ordem de
// Compra, o link que os funcionários da MX usam no celular. Quem é do
// financeiro chega ao painel pelo link "Painel" da própria página.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MX — Ordem de Compra',
    short_name: 'MX Compras',
    description: 'Lance despesas para aprovação da MX Corretora de Seguros.',
    start_url: '/oc',
    scope: '/',
    display: 'standalone',
    background_color: '#071934',
    theme_color: '#071934',
    icons: [
      { src: '/logo_navy.png', sizes: '1080x1080', type: 'image/png', purpose: 'any' },
    ],
  }
}
