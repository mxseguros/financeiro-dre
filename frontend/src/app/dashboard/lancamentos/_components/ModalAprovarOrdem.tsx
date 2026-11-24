// Aprovar Ordem de Compra = lançar a despesa (0047). Quem aprova confirma como
// ela entra na DRE: subitem e centro de custo (e, se quiser, classificação e
// banco). A despesa nasce a pagar no mês da data prevista, em nome de quem pediu.
import { useState } from 'react'
import { api } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { CampoAnexos } from '@/components/anexos/CampoAnexos'
import { OpcoesCentro, rotuloCentro, type CentroCusto } from '@/lib/centros'
import {
  Campo, selectCls, classificacoesDe,
  type Banco, type Categoria, type Classificacao, type OrdemCompra, type TipoLancamento,
} from './shared'

const fmtBRL = (v: number | string | null) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

export function ModalAprovarOrdem({
  token, ordem, categorias, tipos, centros, bancos, classificacoes, onClose, onAprovada,
}: {
  token: string
  ordem: OrdemCompra
  categorias: Categoria[]
  tipos: TipoLancamento[]
  centros: CentroCusto[]
  bancos: Banco[]
  classificacoes?: Classificacao[]
  onClose: () => void
  onAprovada: (o: OrdemCompra) => void
}) {
  const subInicial = tipos.find(t => t.id === ordem.tipo_lancamento_id)
  const [categoriaId, setCategoriaId] = useState(subInicial?.categoria_id ?? '')
  const [subitemId, setSubitemId] = useState(subInicial?.id ?? '')
  const [centro, setCentro] = useState(ordem.centro_custo ?? '')
  const [classificacao, setClassificacao] = useState('')
  const [bancoId, setBancoId] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const categoriasDespesa = categorias.filter(c => c.natureza === 'despesa' && c.ativo)
  const subitens = tipos.filter(t => t.natureza === 'despesa' && t.categoria_id === categoriaId)
  const centroAtual = centros.find(c => c.codigo === ordem.centro_custo)
  const valorOk = ordem.valor != null && Number(ordem.valor) > 0

  async function aprovar() {
    if (!subitemId) { setErro('Escolha o subitem da despesa.'); return }
    if (!centro) { setErro('Escolha o centro de custo.'); return }
    setSalvando(true); setErro(null)
    try {
      const o = await api.patch<OrdemCompra>(`/ordens-compra/${ordem.id}/aprovar`, token, {
        tipo_lancamento_id: subitemId, centro_custo: centro,
        custo_tipo: classificacao || null, banco_id: bancoId || null,
      })
      onAprovada(o)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao aprovar.')
      setSalvando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Aprovar Ordem de Compra" variant="sheet" maxWidth="sm:max-w-lg" dismissable={!salvando}>
      <div className="space-y-3">
        <div className="rounded-xl bg-indigo-50 px-3 py-2.5 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-gray-800">{ordem.assunto}</p>
              <p className="text-xs text-gray-600">{ordem.solicitante} · despesa em {fmtData(ordem.data_prevista ?? ordem.data_solicitacao)}</p>
            </div>
            <p className="shrink-0 font-bold tabular-nums text-indigo-700">{ordem.valor != null ? fmtBRL(ordem.valor) : '—'}</p>
          </div>
          <p className="mt-1.5 whitespace-pre-line text-xs text-gray-600">{ordem.descricao}</p>
          {centroAtual && <p className="mt-1 text-xs text-gray-500">Centro sugerido: {rotuloCentro(centroAtual)}</p>}
        </div>

        <CampoAnexos token={token} entidade="ordem_compra" entidadeId={ordem.id} rotulo="Nota / comprovante" somenteLeitura />

        {!valorOk && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            A ordem está sem valor. Edite a ordem e informe o valor antes de aprovar.
          </p>
        )}

        <p className="text-xs text-gray-500">
          Ao aprovar, a ordem vira uma <strong>despesa a pagar</strong> no mês da data prevista, com a nota anexada.
        </p>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Campo label="Categoria">
            <select value={categoriaId} onChange={e => { setCategoriaId(e.target.value); setSubitemId('') }} className={selectCls}>
              <option value="">Selecionar</option>
              {categoriasDespesa.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Subitem">
            <select value={subitemId} disabled={!categoriaId}
              onChange={e => {
                setSubitemId(e.target.value)
                setClassificacao(c => c || (tipos.find(t => t.id === e.target.value)?.custo_tipo ?? ''))
              }} className={selectCls}>
              <option value="">{categoriaId ? 'Selecionar' : 'Escolha a categoria'}</option>
              {subitens.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Centro de custo">
            <select value={centro} onChange={e => setCentro(e.target.value)} className={selectCls}>
              <option value="">Selecionar</option>
              <OpcoesCentro centros={centros} atual={centro} />
            </select>
          </Campo>
          <Campo label="Classificação">
            <select value={classificacao} onChange={e => setClassificacao(e.target.value)} className={selectCls}>
              <option value="">Padrão do subitem</option>
              {classificacoesDe(classificacoes, 'despesa', classificacao).map(c => (
                <option key={c.codigo} value={c.codigo}>{c.nome}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Banco (opcional)">
            <select value={bancoId} onChange={e => setBancoId(e.target.value)} className={selectCls}>
              <option value="">Sem banco</option>
              {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </Campo>
        </div>

        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={aprovar} loading={salvando} disabled={!valorOk}>
            {salvando ? 'Aprovando…' : 'Aprovar e lançar despesa'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
