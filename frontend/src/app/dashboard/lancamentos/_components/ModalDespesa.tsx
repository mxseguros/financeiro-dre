import { useState } from 'react'
import { api } from '@/lib/api'
import { mesAtual } from '@/lib/utils'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Campo, inputCls, selectCls, type Categoria, type TipoLancamento, type Banco, type CentroCusto, type Despesa, type DespesasResp, type SugestaoIA } from './shared'

interface ModalDespesaProps {
  token: string
  categorias: Categoria[]
  tipos: TipoLancamento[]
  bancos: Banco[]
  centros: CentroCusto[]
  despesa?: Despesa
  mesDefault?: string
  onClose: () => void
  onSaved: () => void
  onTipoAtualizado?: (tipoId: string, custoTipo: string) => void
}

export function ModalDespesa({ token, categorias, tipos, bancos, centros, despesa, mesDefault, onClose, onSaved, onTipoAtualizado }: ModalDespesaProps) {
  const editando = !!despesa
  const tipoInicial = despesa ? tipos.find(t => t.id === despesa.tipo_lancamento_id) : undefined
  const [form, setForm] = useState({
    categoria_id:       tipoInicial?.categoria_id ?? '',
    tipo_lancamento_id: despesa?.tipo_lancamento_id ?? '',
    banco_id:           despesa?.banco_id ?? '',
    descricao:          despesa?.descricao ?? '',
    competencia:        despesa ? despesa.competencia.slice(0, 7) : (mesDefault ?? mesAtual()[0].slice(0, 7)),
    data_vencimento:    despesa?.data_vencimento ?? '',
    paga_em:            despesa?.paga_em ?? '',
    centro_custo:       despesa?.centro_custo ?? 'matriz',
    recorrente:         despesa?.recorrente ?? false,
    repetir_ate:        '',
    // Parcelamento
    // A API serializa Decimal como texto ("4500.00") — Number() antes de formatar.
    valor_parcela:      despesa ? Number(despesa.valor).toFixed(2) : '',
    num_parcelas:       String(despesa?.parcela_total ?? 1),
  })
  const [classificacao, setClassificacao] = useState(tipoInicial?.custo_tipo ?? '')
  const [salvandoClassificacao, setSalvandoClassificacao] = useState(false)
  const [erroClassificacao, setErroClassificacao] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [sugestao, setSugestao] = useState<SugestaoIA | null>(null)
  const [sugerindo, setSugerindo] = useState(false)
  const [sugestaoErro, setSugestaoErro] = useState<string | null>(null)

  const limparErro = (k: string) => setErros(e => (k in e ? { ...e, [k]: '' } : e))
  const set = (k: string, v: string | boolean) => {
    setForm(f => ({ ...f, [k]: v }))
    limparErro(k)
  }

  function selecionarCategoria(categoriaId: string) {
    setForm(f => ({ ...f, categoria_id: categoriaId, tipo_lancamento_id: '' }))
    setClassificacao('')
    limparErro('categoria_id')
  }

  function selecionarSubitem(tipoId: string) {
    set('tipo_lancamento_id', tipoId)
    setClassificacao(tipos.find(t => t.id === tipoId)?.custo_tipo ?? '')
  }

  // Altera a classificação do subitem escolhido — grava em Configurações
  // (é um atributo do subitem, não do lançamento) e reflete aqui na hora.
  async function alterarClassificacao(novoValor: string) {
    setClassificacao(novoValor)
    if (!form.tipo_lancamento_id) return
    setSalvandoClassificacao(true)
    setErroClassificacao(null)
    try {
      await api.put(`/configuracoes/tipos/${form.tipo_lancamento_id}`, token, { custo_tipo: novoValor || null })
      onTipoAtualizado?.(form.tipo_lancamento_id, novoValor)
    } catch (err) {
      setErroClassificacao(err instanceof Error ? err.message : 'Erro ao salvar classificação')
    } finally {
      setSalvandoClassificacao(false)
    }
  }

  // ── Copiloto de IA: sugere Categoria/Subitem/Classificação pela descrição ──
  async function buscarSugestao() {
    const desc = form.descricao.trim()
    if (desc.length < 3) return
    setSugerindo(true); setSugestao(null); setSugestaoErro(null)
    try {
      const [y, m] = form.competencia.split('-')
      const s = await api.post<SugestaoIA>('/lancamentos/sugestao', token, {
        descricao: desc,
        natureza: 'despesa',
        valor: valorParcela > 0 ? valorParcela : undefined,
        competencia: y && m ? `${y}-${m}-01` : undefined,
      })
      setSugestao(s.disponivel || s.duplicata ? s : null)
      if (!s.disponivel) setSugestaoErro(s.motivo ?? 'Sem sugestão para esta descrição.')
    } catch (e) {
      setSugestaoErro(e instanceof Error ? e.message : 'Falha ao consultar a IA.')
    } finally {
      setSugerindo(false)
    }
  }

  function aplicarSugestao(s: SugestaoIA) {
    if (s.categoria_id && s.subitem_id) {
      setForm(f => ({ ...f, categoria_id: s.categoria_id!, tipo_lancamento_id: s.subitem_id! }))
      setClassificacao(s.classificacao ?? tipos.find(t => t.id === s.subitem_id)?.custo_tipo ?? '')
    }
    setSugestao(null); setSugestaoErro(null)
  }

  const categoriasDespesa = categorias.filter(c => c.natureza === 'despesa' && c.ativo)
  const subitensDaCategoria = tipos.filter(t => t.natureza === 'despesa' && t.categoria_id === form.categoria_id)

  const numParcelas = Math.max(1, parseInt(form.num_parcelas) || 1)
  // Digita-se o valor de CADA parcela (o que cai no mes) e o total e derivado.
  // Antes era o inverso: total digitado, dividido por N ao salvar — com
  // arredondamento no meio, ja que no banco `valor` sempre foi por parcela.
  const valorParcela = parseFloat(form.valor_parcela) || 0
  const valorTotal   = valorParcela * numParcelas
  const parcelado    = numParcelas > 1
  // Reparcelar reescreve datas e numeração de todo o grupo a partir da 1ª
  // parcela, então o backend só aceita o pedido vindo dela (422 caso contrário).
  const naoEhPrimeiraParcela = !!editando && (despesa?.parcela_atual ?? 1) > 1

  const nMesesRecorrencia = (() => {
    if (!form.recorrente || !form.repetir_ate || form.repetir_ate < form.competencia) return 0
    const [sy, sm] = form.competencia.split('-').map(Number)
    const [ey, em] = form.repetir_ate.split('-').map(Number)
    return (ey - sy) * 12 + (em - sm) + 1
  })()

  /** Validação por campo — a mensagem aparece ao lado do campo, não em faixa única. */
  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.categoria_id) e.categoria_id = 'Selecione a categoria.'
    if (!form.tipo_lancamento_id) e.tipo_lancamento_id = 'Selecione o subitem.'
    if (!form.descricao.trim()) e.descricao = 'Informe a descrição.'
    if (valorParcela <= 0) e.valor_parcela = 'Informe um valor maior que zero.'
    if (!form.competencia) e.competencia = 'Informe a competência.'
    if (!form.data_vencimento) e.data_vencimento = 'Informe a data de vencimento.'
    if (form.recorrente && !form.repetir_ate) e.repetir_ate = 'Informe até quando repetir.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return
    setSalvando(true)
    setErro(null)
    const [y, m] = form.competencia.split('-')

    try {
      if (editando) {
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          banco_id:           form.banco_id || null,
          descricao:          form.descricao,
          subcategoria:       form.descricao,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          // O backend reconstrói o grupo quando este número muda; quando é
          // igual ao atual, ignora. `valor` acima já é o valor POR PARCELA.
          num_parcelas:       numParcelas,
        }
        payload.paga_em = form.paga_em || null
        await api.patch(`/lancamentos/despesas/${despesa!.id}`, token, payload)
      } else if (parcelado) {
        // Backend cria as N parcelas atomicamente em uma única chamada
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          banco_id:           form.banco_id || null,
          descricao:          form.descricao,
          subcategoria:       form.descricao,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         false,
          num_parcelas:       numParcelas,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        const criada = await api.post<Despesa>('/lancamentos/despesas', token, payload)
        // Guarda de compatibilidade: um backend desatualizado ignora
        // `num_parcelas` e cria apenas 1 registro, sem marcar as parcelas.
        if (criada?.parcela_total !== numParcelas) {
          throw new Error(
            'O servidor está desatualizado e não suporta parcelamento — foi criado apenas 1 lançamento. ' +
            'Exclua-o e contate o administrador para atualizar o backend.'
          )
        }
      } else if (form.recorrente && form.repetir_ate && form.repetir_ate >= form.competencia) {
        // Backend cria um registro por mês atomicamente em uma única chamada
        const [ey, em] = form.repetir_ate.split('-')
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          banco_id:           form.banco_id || null,
          descricao:          form.descricao,
          subcategoria:       form.descricao,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         true,
          repetir_ate:        `${ey}-${em}-01`,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        await api.post('/lancamentos/despesas', token, payload)
        // Guarda de compatibilidade: um backend desatualizado ignora
        // `repetir_ate` e cria apenas o 1º mês. Confere se o último mês existe.
        if (form.repetir_ate > form.competencia) {
          const ultimoDia = new Date(Number(ey), Number(em), 0).getDate()
          const check = await api.get<DespesasResp>(
            `/lancamentos/despesas?inicio=${ey}-${em}-01&fim=${ey}-${em}-${String(ultimoDia).padStart(2, '0')}`, token)
          const criouUltimoMes = (check.items ?? []).some(d =>
            d.descricao === form.descricao && d.competencia.slice(0, 7) === form.repetir_ate)
          if (!criouUltimoMes) {
            throw new Error(
              'O servidor está desatualizado e não suporta recorrência — foi criado apenas o 1º mês. ' +
              'Exclua-o e contate o administrador para atualizar o backend.'
            )
          }
        }
      } else {
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          banco_id:           form.banco_id || null,
          descricao:          form.descricao,
          subcategoria:       form.descricao,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         form.recorrente,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        await api.post('/lancamentos/despesas', token, payload)
      }
      onSaved()
      onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar')
      setSalvando(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editando ? 'Editar Despesa' : 'Nova Despesa'}
      variant="sheet"
      maxWidth="sm:max-w-xl"
      dismissable={!salvando}
    >
      {editando && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700">
          A despesa voltará para <strong>Pendente</strong> e precisará de nova aprovação.
        </div>
      )}

      <form onSubmit={salvar} noValidate className="space-y-2.5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          <Field label="Categoria" required error={erros.categoria_id}>
            {p => (
              <Select {...p} size="sm" value={form.categoria_id} onChange={e => selecionarCategoria(e.target.value)}>
                <option value="">Selecionar categoria</option>
                {categoriasDespesa.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Subitem" required error={erros.tipo_lancamento_id}>
            {p => (
              <Select {...p} size="sm" disabled={!form.categoria_id} value={form.tipo_lancamento_id}
                onChange={e => selecionarSubitem(e.target.value)}>
                <option value="">{form.categoria_id ? 'Selecionar subitem' : 'Escolha a categoria primeiro'}</option>
                {subitensDaCategoria.map(t => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          <Campo label="Classificação">
            <select disabled={!form.tipo_lancamento_id} value={classificacao}
              onChange={e => alterarClassificacao(e.target.value)} className={selectCls}>
              <option value="">{form.tipo_lancamento_id ? 'Selecionar' : 'Escolha o subitem primeiro'}</option>
              <option value="fixo">Fixo</option>
              <option value="variavel">Variável</option>
              <option value="imposto">Imposto</option>
            </select>
          </Campo>
          <Campo label="Banco">
            <select value={form.banco_id} onChange={e => set('banco_id', e.target.value)} className={selectCls}>
              <option value="">Sem banco</option>
              {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Centro de custo">
            <select value={form.centro_custo} onChange={e => set('centro_custo', e.target.value)} className={selectCls}>
              {centros.filter(c => c.ativo || c.codigo === form.centro_custo).map(c => (
                <option key={c.id} value={c.codigo}>{c.nome}</option>
              ))}
            </select>
          </Campo>
        </div>
        {(salvandoClassificacao || erroClassificacao || (!salvandoClassificacao && !erroClassificacao && form.tipo_lancamento_id)) && (
          <p className={`-mt-1.5 text-xs ${erroClassificacao ? 'text-red-600' : 'text-gray-400'}`}>
            {salvandoClassificacao ? 'Salvando classificação…' : erroClassificacao || 'Alterar a classificação altera o subitem em Configurações.'}
          </p>
        )}

        <Field label="Descrição" required error={erros.descricao}>
          {p => (
            <Input {...p} size="sm" value={form.descricao} onChange={e => set('descricao', e.target.value)}
              onBlur={() => { if (!editando && !form.tipo_lancamento_id && !sugestao && !sugerindo) buscarSugestao() }}
              placeholder="Ex: Aluguel sede matriz" />
          )}
        </Field>

        {/* Copiloto de IA — sugere a classificação a partir da descrição */}
        <div className="-mt-1">
          <button type="button" onClick={buscarSugestao}
            disabled={sugerindo || form.descricao.trim().length < 3}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50">
            {sugerindo ? 'Consultando IA…' : '✨ Sugerir classificação com IA'}
          </button>
          {sugestao?.disponivel && (
            <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-semibold text-indigo-900">Sugestão: </span>
                  <span className="text-indigo-800">{sugestao.categoria_nome} › {sugestao.subitem_nome}</span>
                  {sugestao.classificacao && <span className="ml-1 capitalize text-indigo-700">· {sugestao.classificacao}</span>}
                  {sugestao.confianca && <span className="ml-1 text-indigo-400">({sugestao.confianca})</span>}
                </div>
                <button type="button" onClick={() => aplicarSugestao(sugestao)}
                  className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-700">
                  Aplicar
                </button>
              </div>
              {sugestao.motivo && <p className="mt-1 text-indigo-500">{sugestao.motivo}</p>}
            </div>
          )}
          {sugestaoErro && <p className="mt-1 text-xs text-gray-400">{sugestaoErro}</p>}
          {sugestao?.duplicata && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
              ⚠️ Possível duplicata: já existe {sugestao.duplicata.quantidade} despesa(s) com a mesma descrição e valor neste mês.
            </div>
          )}
        </div>

        {/* Valor, Parcelamento e Competência */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          <Field label="Valor da Parcela" required error={erros.valor_parcela}>
            {() => <InputMoeda value={form.valor_parcela} onChange={v => set('valor_parcela', v)} />}
          </Field>
          <Campo label="Nº de Parcelas">
            {/* Sempre editavel (pedido de 29/09/2026). Recorrencia e parcelamento
                continuam exclusivos, mas agora a troca e automatica: na criacao,
                parcelar desmarca "repetir"; na edicao, o backend converte a serie. */}
            <input type="number" min="1" max="60" value={form.num_parcelas}
              onChange={e => {
                const v = e.target.value
                set('num_parcelas', v)
                if (!editando && (parseInt(v) || 1) > 1 && form.recorrente) set('recorrente', false)
              }}
              className={inputCls} />
            {editando && form.recorrente && numParcelas > 1 && (
              <p className="mt-1 text-[11px] text-amber-600">
                Esta despesa é recorrente: ao salvar, a série deste mês em diante vira {numParcelas} parcelas.
              </p>
            )}
            {naoEhPrimeiraParcela && (
              <p className="mt-1 text-[11px] text-gray-400">
                Parcela {despesa?.parcela_atual} de {despesa?.parcela_total} — alterar o número refaz o parcelamento a partir da 1ª parcela.
              </p>
            )}
          </Campo>
          <Field label={naoEhPrimeiraParcela ? 'Competência' : 'Competência (1ª parc.)'} required error={erros.competencia}>
            {p => (
              <Input {...p} size="sm" type="month" value={form.competencia}
                onChange={e => set('competencia', e.target.value)} />
            )}
          </Field>
        </div>

        {valorParcela > 0 && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-1.5 text-xs text-blue-700">
            Valor Total: <strong>R$ {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
            {' '}({numParcelas} {numParcelas === 1 ? 'parcela' : 'parcelas'} de R$ {valorParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
          </div>
        )}

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          <Field label="Data de Vencimento" required error={erros.data_vencimento}>
            {p => (
              <Input {...p} size="sm" type="date" value={form.data_vencimento}
                onChange={e => set('data_vencimento', e.target.value)} />
            )}
          </Field>
          <Campo label="Data de Pagamento">
            <input type="date" value={form.paga_em} onChange={e => set('paga_em', e.target.value)} className={inputCls} />
          </Campo>
        </div>

        {/* A data informada vale para a 1ª parcela/ocorrência — as demais são
            pagas mês a mês, editando cada lançamento. */}
        {!editando && (parcelado || form.recorrente) && (
          <p className="-mt-1 text-xs text-gray-400">
            A Data de Pagamento se aplica {parcelado ? 'à 1ª parcela' : 'ao 1º mês'}; as demais ficam em aberto para pagamento mês a mês.
          </p>
        )}

        {/* Recorrente — só aparece quando não é parcelado e não está editando */}
        {!parcelado && !editando && (
          <div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.recorrente as boolean}
                onChange={e => set('recorrente', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy"
              />
              <span className="text-sm font-medium text-gray-700">Despesa recorrente (repete todo mês)</span>
            </label>
            {form.recorrente && (
              <Field label="Repetir até (mês/ano)" required error={erros.repetir_ate} className="max-w-[180px]">
                {p => (
                  <Input {...p} size="sm" type="month" value={form.repetir_ate} min={form.competencia}
                    onChange={e => set('repetir_ate', e.target.value)} />
                )}
              </Field>
            )}
            {nMesesRecorrencia > 1 && (
              <p className="text-xs text-blue-600">Serão criados <strong>{nMesesRecorrencia} registros</strong> mensais.</p>
            )}
          </div>
        )}

        {/* Erro de submissão (servidor). Erros de preenchimento ficam nos campos. */}
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" loading={salvando}>
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : parcelado ? `Criar ${numParcelas} parcelas` : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
