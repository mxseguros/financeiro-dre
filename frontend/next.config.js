// Gatilho de deploy reconectado em 31/08/2026 (GitHub App da Vercel na org).
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Headers de segurança — a Vercel só adiciona HSTS sozinha; o resto é nosso.
  // Auditoria de 28/08/2026: sem X-Frame-Options a tela de login podia ser
  // embutida em iframe de terceiro (clickjacking sobre um sistema financeiro).
  // Relatórios substituiu o Monitoramento IA (26/10/2026); o endereço antigo segue valendo.
  async redirects() {
    return [{ source: '/dashboard/assistente', destination: '/dashboard/relatorios', permanent: false }]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Nenhuma página deste app tem razão para viver dentro de iframe.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Navegador não pode "adivinhar" content-type de resposta.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // URLs internas (com ids de lançamento) não vazam em Referer externo.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Recursos de hardware que o app não usa ficam negados por padrão.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
