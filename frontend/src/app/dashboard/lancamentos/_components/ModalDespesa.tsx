import { OpcoesCentro } from '@/lib/centros'
import { CampoAnexos, enviarAnexos, type AnexoPendente } from '@/components/anexos/CampoAnexos'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { mesAtual } from '@/lib/utils'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { AvisoRecorrencia, type SerieRecorrencia } from './AvisoRecorrencia'
import { BlocoPagamento, estadoPagamentoVazio, pagamentoPreenchido, salvarPagamento, type EstadoPagamento } from '@/components/pagamentos/BlocoPagamento'
import { Campo, inputCls, selectCls, type Categoria, type TipoLancamento, type Banco, type CentroCusto, type Despesa, type DespesasResp, type Classificacao, type Receita, classificacoesDe } from './shared'
import { DicaEspelhoIndisponivel, ESPELHO_VAZIO, FaixaVinculo, PainelEspelho, ehEmprestimo, payloadEspelho, useVinculo, type EspelhoForm } from './Emprestimo'

// Limites espelhados de DespesaCreate/DespesaUpdate (app/models/schemas.py).
// Sem eles o backend devolvia 422 e a tela mostrava só "HTTP 422".
// Parcelas: sem limite de negócio (pedido de 07/10/2026). 999 é só teto técnico —
// cada parcela vira um lançamento mensal, e um erro de digitação como "12000"
// gravaria milhares de linhas de uma vez. A lista oferece atalhos de 1 a 120.
const MAX_PARCELAS = 999
const OPCOES_PARCELAS = Array.from({ length: 120 }, (_, i) => i + 1)
const DESCRICAO_MIN = 3
const DESCRICAO_MAX = 500
const SUBCATEGORIA_MAX = 100

/** Último mês aceito como competência: até 2 meses à frente do atual (AAAA-MM). */
function competenciaMaxima(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + 2)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface SeletorParcelasProps {
  id: string
  value: string
  onChange: (v: string) => void
  'aria-invalid': boolean | undefined
  'aria-describedby': string | undefined
}

/** Nº de parcelas: escolhe na lista (atalhos de 1 a 120) ou digita qualquer número. */
function SeletorParcelas({ id, value, onChange, ...aria }: SeletorParcelasProps) {
  const [aberto, setAberto] = useState(false)
  const listaRef = useRef<HTMLUListElement>(null)
  const atual = parseInt(value) || 0
  const listaId = `${id}-opcoes`

  useEffect(() => {
    if (!aberto) return
    listaRef.current?.querySelector<HTMLElement>(`[data-n="${atual}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [aberto, atual])

  const escolher = (n: number) => { onChange(String(n)); setAberto(false) }

  return (
    <div className="relative">
      <Input {...aria} id={id} size="sm" type="text" inputMode="numeric" autoComplete="off"
        role="combobox" aria-expanded={aberto} aria-controls={listaId}
        value={value} placeholder="Ex.: 12" className="pr-8"
        onChange={e => { onChange(e.target.value.replace(/\D/g, '').slice(0, 4)); setAberto(true) }}
        onFocus={() => setAberto(true)}
        onBlur={() => { setAberto(false); if (!value) onChange('1') }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = Math.min(MAX_PARCELAS, Math.max(1, (atual || 1) + (e.key === 'ArrowDown' ? 1 : -1)))
            onChange(String(n)); setAberto(true)
          } else if (e.key === 'Enter' && aberto) {
            e.preventDefault(); setAberto(false)
          }
        }} />
      <button type="button" tabIndex={-1} aria-label="Abrir lista de parcelas"
        onMouseDown={e => { e.preventDefault(); setAberto(a => !a) }}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-gray-400 hover:text-gray-600">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {aberto && (
        <ul ref={listaRef} id={listaId} role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {OPCOES_PARCELAS.map(n => (
            <li key={n} data-n={n} role="option" aria-selected={n === atual}
              // mousedown (e não click) para escolher antes do blur do campo fechar a lista
              onMouseDown={e => { e.preventDefault(); escolher(n) }}
              className={`cursor-pointer px-2.5 py-1 ${n === atual ? 'bg-navy text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
              {n === 1 ? '1x (sem parcelar)' : `${n}x`}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

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
  classificacoes?: Classificacao[]
  /** Editando: mostra Excluir no rodapé (o botão saiu da linha da tabela, redesenho UX). */
  onExcluir?: () => void
  /** Empréstimo vinculado: abre o lado receita no lugar deste modal. */
  onAbrirVinculado?: (tipo: 'despesa' | 'receita', item: Despesa | Receita) => void
}

export function ModalDespesa({ token, categorias, tipos, bancos, centros, despesa, mesDefault, onClose, onSaved, classificacoes, onExcluir, onAbrirVinculado }: ModalDespesaProps) {
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
  // Classificação é do LANÇAMENTO (migration 0040): ao escolher o subitem,
  // vem preenchida com o padrão dele, se ainda estiver vazia.
  const [classificacao, setClassificacao] = useState(despesa?.custo_tipo ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [anexosPendentes, setAnexosPendentes] = useState<AnexoPendente[]>([])
  // Salvou, mas algum anexo falhou: não deixa salvar de novo (duplicaria a despesa).
  const [falhaAnexos, setFalhaAnexos] = useState<string | null>(null)
  // Bloco "Pagamento" (CNAB, 0050): gravado depois da despesa.
  const [pagamento, setPagamento] = useState<EstadoPagamento>(estadoPagamentoVazio())
  // Empréstimo (28/11/2026): receita espelho na criação; faixa do vínculo na edição.
  const [espelho, setEspelho] = useState<EspelhoForm>(ESPELHO_VAZIO)
  const vinculado = useVinculo(token, 'despesa', despesa?.id)

  // Se o modal abriu antes de a taxonomia terminar de carregar, a categoria
  // nasceu vazia — o useState acima só calcula o valor inicial uma vez — e o
  // Salvar ficava barrado por "Selecione a categoria.". Completa quando os
  // subitens chegarem, sem sobrescrever uma escolha já feita pelo usuário.
  useEffect(() => {
    if (!despesa?.tipo_lancamento_id) return
    const t = tipos.find(x => x.id === despesa.tipo_lancamento_id)
    if (!t?.categoria_id) return
    setForm(f => (f.categoria_id ? f : { ...f, categoria_id: t.categoria_id as string }))
  }, [tipos, despesa?.tipo_lancamento_id])

  const limparErro = (k: string) => setErros(e => (k in e ? { ...e, [k]: '' } : e))
  const set = (k: string, v: string | boolean) => {
    setForm(f => ({ ...f, [k]: v }))
    limparErro(k)
  }

  function selecionarCategoria(categoriaId: string) {
    setForm(f => ({ ...f, categoria_id: categoriaId, tipo_lancamento_id: '' }))
    limparErro('categoria_id')
  }

  function selecionarSubitem(tipoId: string) {
    set('tipo_lancamento_id', tipoId)
    setClassificacao(c => c || (tipos.find(t => t.id === tipoId)?.custo_tipo ?? ''))
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
  const categoriaEmprestimo = ehEmprestimo(categorias.find(c => c.id === form.categoria_id)?.nome)
  const espelhoDisponivel = !editando && categoriaEmprestimo && !parcelado && !form.recorrente
  // Reparcelar reescreve datas e numeração de todo o grupo a partir da 1ª
  // parcela, então o backend só aceita o pedido vindo dela (422 caso contrário).
  const naoEhPrimeiraParcela = !!editando && (despesa?.parcela_atual ?? 1) > 1

  // Recorrência na edição (24/11/2026): a série atual vem da API e o
  // "Repetir até" abre preenchido com o último mês dela.
  const [serie, setSerie] = useState<SerieRecorrencia | null>(null)
  useEffect(() => {
    if (!despesa?.id || (despesa.parcela_total ?? 1) > 1) return
    api.get<SerieRecorrencia>(`/lancamentos/despesas/${despesa.id}/recorrencia`, token)
      .then(s => {
        setSerie(s)
        setForm(f => ({ ...f, recorrente: s.recorrente, repetir_ate: s.ate ? s.ate.slice(0, 7) : '' }))
      })
      .catch(() => {})
  }, [despesa?.id, despesa?.parcela_total, token])
  const mudouRecorrencia = !!serie && (form.recorrente !== serie.recorrente
    || (form.recorrente && form.repetir_ate !== (serie.ate ?? '').slice(0, 7)))

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
    const desc = form.descricao.trim()
    if (!desc) e.descricao = 'Informe a descrição.'
    else if (desc.length < DESCRICAO_MIN) e.descricao = `A descrição precisa de pelo menos ${DESCRICAO_MIN} caracteres.`
    else if (desc.length > DESCRICAO_MAX) e.descricao = `A descrição pode ter no máximo ${DESCRICAO_MAX} caracteres.`
    if (valorParcela <= 0) e.valor_parcela = 'Informe um valor maior que zero.'
    const nParc = parseInt(form.num_parcelas)
    if (form.num_parcelas && (!(nParc >= 1) || nParc > MAX_PARCELAS)) e.num_parcelas = `Informe um número de parcelas entre 1 e ${MAX_PARCELAS}.`
    if (!form.competencia) e.competencia = 'Informe a competência.'
    // A trava de competência futura só existe na criação (DespesaCreate).
    else if (!editando && form.competencia > competenciaMaxima()) e.competencia = 'A competência pode ser no máximo 2 meses à frente.'
    if (!form.data_vencimento) e.data_vencimento = 'Informe a data de vencimento.'
    // Só na criação: o campo "Repetir até" não é desenhado na edição, e exigi-lo
    // ali travava o Salvar de toda despesa recorrente em silêncio (erro num
    // campo invisível).
    if (form.recorrente && !form.repetir_ate && (!editando || (serie && !parcelado))) e.repetir_ate = 'Informe até quando repetir.'
    else if (editando && form.recorrente && form.repetir_ate && form.repetir_ate < form.competencia) e.repetir_ate = 'Não pode ser antes da competência.'
    if (espelhoDisponivel && espelho.ativo && !espelho.tipo_lancamento_id) e.espelho = 'Selecione o subitem da receita.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) {
      // Rede de segurança: se algum erro cair num campo fora da tela, o
      // usuário ainda vê que o salvamento foi barrado — nunca mais botão "morto".
      setErro('Revise os campos destacados antes de salvar.')
      return
    }
    setSalvando(true)
    setErro(null)
    const [y, m] = form.competencia.split('-')
    const descricao = form.descricao.trim()
    // `subcategoria` repete a descrição, mas no banco o limite é 100 caracteres
    // (a descrição aceita 500) — descrição longa dava 422 ao salvar.
    const subcategoria = descricao.slice(0, SUBCATEGORIA_MAX)

    try {
      let criadaId: string | undefined
      if (editando) {
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          custo_tipo:         classificacao || null,
          banco_id:           form.banco_id || null,
          descricao,
          subcategoria,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          // O backend reconstrói o grupo quando este número muda; quando é
          // igual ao atual, ignora. `valor` acima já é o valor POR PARCELA.
          num_parcelas:       numParcelas,
        }
        payload.paga_em = form.paga_em || null
        // Só manda a recorrência quando ela mudou: o backend cria, remove ou
        // desmarca as ocorrências seguintes a partir desta.
        if (mudouRecorrencia && !parcelado) {
          payload.recorrente = form.recorrente
          if (form.recorrente) payload.repetir_ate = `${form.repetir_ate}-01`
        }
        await api.patch(`/lancamentos/despesas/${despesa!.id}`, token, payload)
      } else if (parcelado) {
        // Backend cria as N parcelas atomicamente em uma única chamada
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          custo_tipo:         classificacao || null,
          banco_id:           form.banco_id || null,
          descricao,
          subcategoria,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         false,
          num_parcelas:       numParcelas,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        const criada = await api.post<Despesa>('/lancamentos/despesas', token, payload)
        criadaId = criada?.id
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
          custo_tipo:         classificacao || null,
          banco_id:           form.banco_id || null,
          descricao,
          subcategoria,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         true,
          repetir_ate:        `${ey}-${em}-01`,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        criadaId = (await api.post<Despesa>('/lancamentos/despesas', token, payload))?.id
        // Guarda de compatibilidade: um backend desatualizado ignora
        // `repetir_ate` e cria apenas o 1º mês. Confere se o último mês existe.
        if (form.repetir_ate > form.competencia) {
          const ultimoDia = new Date(Number(ey), Number(em), 0).getDate()
          const check = await api.get<DespesasResp>(
            `/lancamentos/despesas?inicio=${ey}-${em}-01&fim=${ey}-${em}-${String(ultimoDia).padStart(2, '0')}`, token)
          const criouUltimoMes = (check.items ?? []).some(d =>
            d.descricao === descricao && d.competencia.slice(0, 7) === form.repetir_ate)
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
          custo_tipo:         classificacao || null,
          banco_id:           form.banco_id || null,
          descricao,
          subcategoria,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         form.recorrente,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        if (espelhoDisponivel) payload.espelho = payloadEspelho(espelho)
        criadaId = (await api.post<Despesa>('/lancamentos/despesas', token, payload))?.id
      }
      // Pagamento: na despesa editada, se mudou; na nova, na 1ª parcela/ocorrência.
      const alvoPagamento = editando ? (pagamento.alterado ? despesa!.id : undefined)
        : (criadaId && pagamentoPreenchido(pagamento) ? criadaId : undefined)
      let falhaPagamento: string | null = null
      if (alvoPagamento) {
        try {
          const avisos = await salvarPagamento(token, alvoPagamento, pagamento)
          if (avisos.length) falhaPagamento = `Despesa salva. Atenção: ${avisos.join(' ')}`
        } catch (e) {
          if (editando) throw e
          falhaPagamento = `A despesa foi salva, mas os dados de pagamento não: ${e instanceof Error ? e.message : 'erro'}. Abra a despesa para corrigir.`
        }
      }
      // Anexos de despesa nova: vão para a 1ª parcela/ocorrência.
      if (criadaId && anexosPendentes.length) {
        const falhas = await enviarAnexos(token, 'despesa', criadaId, anexosPendentes)
        if (falhas.length) {
          onSaved()
          setFalhaAnexos(`A despesa foi salva, mas: ${falhas.join(' ')} Abra a despesa para anexar de novo.${falhaPagamento ? ` ${falhaPagamento}` : ''}`)
          setSalvando(false)
          return
        }
      }
      if (falhaPagamento) {
        onSaved()
        setFalhaAnexos(falhaPagamento)
        setSalvando(false)
        return
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
      <FaixaVinculo token={token} vinculado={vinculado} onAbrir={onAbrirVinculado} />
      {/* Regra de 19/10/2026: Data de Pagamento aprova a despesa (qualquer perfil). */}
      {editando && (form.paga_em ? (
        <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs text-green-700">
          Com Data de Pagamento, a despesa fica <strong>Aprovada</strong>.
        </div>
      ) : (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700">
          A despesa voltará para <strong>Pendente</strong> e precisará de nova aprovação.
        </div>
      ))}

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
            <select value={classificacao}
              onChange={e => setClassificacao(e.target.value)} className={selectCls}>
              <option value="">Selecionar</option>
              {classificacoesDe(classificacoes, 'despesa', classificacao).map(c => (
                <option key={c.codigo} value={c.codigo}>{c.nome}</option>
              ))}
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
              <OpcoesCentro centros={centros} atual={form.centro_custo} />
            </select>
          </Campo>
        </div>

        <Field label="Descrição" required error={erros.descricao}>
          {p => (
            <Input {...p} size="sm" value={form.descricao} onChange={e => set('descricao', e.target.value)}
              maxLength={DESCRICAO_MAX}
              placeholder="Ex: Aluguel sede matriz" />
          )}
        </Field>

        {/* Valor, Parcelamento e Competência */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          <Field label="Valor da Parcela" required error={erros.valor_parcela}>
            {() => <InputMoeda value={form.valor_parcela} onChange={v => set('valor_parcela', v)} />}
          </Field>
          <Field label="Nº de Parcelas" error={erros.num_parcelas}>
            {/* Sempre editavel (pedido de 29/09/2026). Recorrencia e parcelamento
                continuam exclusivos, mas agora a troca e automatica: na criacao,
                parcelar desmarca "repetir"; na edicao, o backend converte a serie. */}
            {p => (
              <SeletorParcelas {...p} value={form.num_parcelas}
                onChange={v => {
                  set('num_parcelas', v)
                  if (!editando && (parseInt(v) || 1) > 1 && form.recorrente) set('recorrente', false)
                }} />
            )}
          </Field>
          <Field label={naoEhPrimeiraParcela ? 'Competência' : 'Competência (1ª parc.)'} required error={erros.competencia}>
            {p => (
              <Input {...p} size="sm" type="month" value={form.competencia}
                onChange={e => set('competencia', e.target.value)} />
            )}
          </Field>
        </div>

        {/* Avisos em largura inteira: dentro da coluna do Nº de Parcelas
            (1/3 do modal) quebravam em quatro linhas. */}
        {editando && form.recorrente && numParcelas > 1 && (
          <p className="-mt-1 text-xs text-amber-600">
            Esta despesa é recorrente: ao salvar, a série deste mês em diante vira {numParcelas} parcelas.
          </p>
        )}
        {naoEhPrimeiraParcela && (
          <p className="-mt-1 text-xs text-gray-400">
            Parcela {despesa?.parcela_atual} de {despesa?.parcela_total} — alterar o número refaz o parcelamento a partir da 1ª parcela.
          </p>
        )}

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
        {!editando && form.paga_em && (
          <p className="-mt-1 text-xs text-green-700">
            Com Data de Pagamento, a despesa entra como <strong>Aprovada</strong>{parcelado ? ' (a 1ª parcela)' : form.recorrente ? ' (o 1º mês)' : ''}.
          </p>
        )}

        {/* Recorrente — não combina com parcelamento. Na edição (24/11/2026),
            liga, estende, encurta ou desliga a série a partir desta despesa. */}
        {!parcelado && (!editando || serie) && (
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
            {!editando && nMesesRecorrencia > 1 && (
              <p className="text-xs text-blue-600">Serão criados <strong>{nMesesRecorrencia} registros</strong> mensais.</p>
            )}
            {editando && serie && <AvisoRecorrencia serie={serie} recorrente={form.recorrente} ate={form.repetir_ate} competencia={form.competencia} />}
          </div>
        )}

        {espelhoDisponivel && (
          <PainelEspelho lado="receita" valor={espelho} onChange={v => { setEspelho(v); limparErro('espelho') }}
            categorias={categorias} tipos={tipos} bancos={bancos} centros={centros} erro={erros.espelho}
            base={{ subitemNome: tipos.find(t => t.id === form.tipo_lancamento_id)?.nome, banco_id: form.banco_id, centro_custo: form.centro_custo }} />
        )}
        {!editando && categoriaEmprestimo && !espelhoDisponivel && <DicaEspelhoIndisponivel />}

        <BlocoPagamento token={token} despesaId={despesa?.id} valorDespesa={valorParcela}
          valor={pagamento} onChange={setPagamento} />
        {!editando && pagamentoPreenchido(pagamento) && (parcelado || form.recorrente) && (
          <p className="-mt-1 text-xs text-gray-400">O pagamento fica na {parcelado ? '1ª parcela' : 'despesa do 1º mês'}.</p>
        )}

        <CampoAnexos token={token} entidade="despesa" entidadeId={despesa?.id}
          pendentes={anexosPendentes} onPendentes={setAnexosPendentes} />
        {!editando && anexosPendentes.length > 0 && (parcelado || form.recorrente) && (
          <p className="-mt-1 text-xs text-gray-400">Os anexos ficam na {parcelado ? '1ª parcela' : 'despesa do 1º mês'}.</p>
        )}

        {/* Erro de submissão (servidor). Erros de preenchimento ficam nos campos. */}
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
        {falhaAnexos && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-700">{falhaAnexos}</p>}

        <div className="flex items-center justify-end gap-3 pt-1">
          {onExcluir && !falhaAnexos && (
            <Button type="button" variant="ghost" tone="danger" onClick={onExcluir} disabled={salvando}
              className="mr-auto">Excluir</Button>
          )}
          {falhaAnexos ? (
            <Button type="button" onClick={onClose}>Fechar</Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
              <Button type="submit" loading={salvando}>
                {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : parcelado ? `Criar ${numParcelas} parcelas` : 'Salvar'}
              </Button>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}
