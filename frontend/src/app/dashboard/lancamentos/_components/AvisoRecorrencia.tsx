// Aviso do que acontece ao salvar a recorrência na edição (24/11/2026).
// Usado em ModalDespesa e ModalReceita.

export interface SerieRecorrencia {
  recorrente: boolean
  /** Último mês da série (AAAA-MM-01), ou null quando não é recorrente. */
  ate: string | null
  meses: number
}

const mesAno = (aaaaMm: string) => `${aaaaMm.slice(5, 7)}/${aaaaMm.slice(0, 4)}`

function mesesEntre(de: string, ate: string) {
  const [dy, dm] = de.split('-').map(Number)
  const [ay, am] = ate.split('-').map(Number)
  return (ay - dy) * 12 + (am - dm)
}

export function AvisoRecorrencia({ serie, recorrente, ate, competencia }: {
  serie: SerieRecorrencia; recorrente: boolean; ate: string; competencia: string
}) {
  const ateSerie = (serie.ate ?? '').slice(0, 7)
  let texto: string | null = null
  let cor = 'text-blue-600'
  if (!recorrente && serie.recorrente) {
    texto = 'Ao salvar, esta deixa de repetir e as ocorrências futuras em aberto (não pagas) são removidas.'
    cor = 'text-amber-600'
  } else if (recorrente && ate && ate >= competencia) {
    if (!serie.recorrente) {
      const n = mesesEntre(competencia, ate)
      texto = n > 0 ? `Ao salvar, serão criados ${n} lançamento(s), do mês seguinte até ${mesAno(ate)}.` : null
    } else if (ate > ateSerie) {
      texto = `Ao salvar, a série vai até ${mesAno(ate)}: os meses depois de ${mesAno(ateSerie)} serão criados.`
    } else if (ate < ateSerie) {
      texto = `Ao salvar, as ocorrências em aberto depois de ${mesAno(ate)} serão removidas (as pagas ficam).`
      cor = 'text-amber-600'
    } else {
      texto = `Repete todo mês até ${mesAno(ate)} (${serie.meses} meses a partir desta).`
      cor = 'text-gray-500'
    }
  }
  return texto ? <p className={`text-xs ${cor}`}>{texto}</p> : null
}
