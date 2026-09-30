// Formatação da DRE: reais inteiros (como a planilha) e percentuais de frações.
// null/NaN viram "—" — a regra "sem realizado ≠ zero" do plano (§4).

const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const umaCasa = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function brl(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const r = Math.round(v)
  return `${r < 0 ? '-' : ''}R$ ${inteiro.format(Math.abs(r))}`
}

export function brlSinal(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return (v > 0 ? '+' : '') + brl(v)
}

/** Fração → "12,3%". */
export function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${umaCasa.format(v * 100)}%`
}

export function brlMil(v: number): string {
  return `${inteiro.format(Math.round(v / 1000))}k`
}
