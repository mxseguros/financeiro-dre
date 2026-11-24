'use client'
// Link fácil de Ordem de Compra para os funcionários da MX (24/11/2026).
//
// O funcionário (perfil Colaborador) entra por /oc — dá para salvar na tela
// inicial do celular — e lança a despesa que vai ter, com foto da nota:
// "viajo amanhã para SP, R$ 150 de gasolina". A ordem vai para Aprovações;
// aprovada, vira despesa a pagar no mês da data prevista.
//
// 0048: o celular pode ser de uso compartilhado — a pessoa escolhe o próprio
// nome em "Quem é você?" (Configurações → Funcionários). Depois da aprovação,
// o funcionário fotografa o recibo aqui e o financeiro confere.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Spinner } from '@/components/ui/Button'
import { CampoAnexos, enviarAnexo, enviarAnexos, type AnexoPendente } from '@/components/anexos/CampoAnexos'
import { OpcoesCentro, nomeCentro, type CentroCusto } from '@/lib/centros'
import type { Funcionario } from '@/lib/funcionarios'
import { SeloRecibo } from '@/lib/recibo'
import type { Usuario } from '@/types'

interface Ordem {
  id: string; solicitante: string; assunto: string; descricao: string
  valor: number | string | null; data_solicitacao: string; data_prevista: string | null
  centro_custo: string | null; status: string; rejeitado_motivo: string | null
  despesa_id: string | null
  funcionario_id?: string | null
  recibo_status?: 'aguardando' | 'enviado' | 'aprovado' | 'devolvido' | null
  recibo_motivo?: string | null
}

const CHAVE_FUNCIONARIO = 'oc.funcionario'
const faltaRecibo = (o: Ordem) => o.recibo_status === 'aguardando' || o.recibo_status === 'devolvido'

/** Enviada · Aprovada · Recibo enviado · Recibo OK */
function LinhaDoTempo({ o }: { o: Ordem }) {
  if (o.status === 'rejeitada') return null
  const passo = o.recibo_status === 'aprovado' ? 4
    : o.recibo_status === 'enviado' ? 3
    : o.status === 'aprovada' ? 2 : 1
  const nomes = ['Enviada', 'Aprovada', 'Recibo enviado', 'Recibo OK']
  return (
    <ol className="mt-2 flex items-center gap-1" aria-label="Andamento">
      {nomes.map((n, i) => (
        <li key={n} className="flex flex-1 flex-col items-center gap-1">
          <span className={`h-1.5 w-full rounded-full ${i < passo ? 'bg-navy' : 'bg-gray-200'}`} />
          <span className={`text-[10px] leading-tight ${i < passo ? 'text-navy' : 'text-gray-400'} ${i === passo - 1 ? 'font-semibold' : ''}`}>{n}</span>
        </li>
      ))}
    </ol>
  )
}

/** Card de "falta o recibo": foto pela câmera, prévia e envio. */
function EnviarRecibo({ ordem, token, onEnviado }: { ordem: Ordem; token: string; onEnviado: (msg: string) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const id = `recibo-${ordem.id}`

  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa) }, [previa])

  function escolher(f: File | undefined) {
    setErro(null)
    if (!f) return
    if (f.size > 10 * 1024 * 1024) { setErro('A foto passa de 10 MB. Tire outra com menos zoom.'); return }
    setArquivo(f)
    setPrevia(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }

  async function enviar() {
    if (!arquivo) return
    setEnviando(true); setErro(null)
    try {
      const anexo = await enviarAnexo(token, 'ordem_compra', ordem.id, arquivo, 'comprovante')
      await api.post(`/ordens-compra/${ordem.id}/recibo`, token, { anexo_id: anexo.id })
      onEnviado(`Recibo de "${ordem.assunto}" enviado. O financeiro vai conferir.`)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar o recibo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <li className="rounded-xl border border-amber-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-800">{ordem.assunto}</p>
          <p className="text-xs text-gray-500">{fmtData(ordem.data_prevista ?? ordem.data_solicitacao)} · {ordem.solicitante}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-800">{fmtBRL(ordem.valor)}</span>
      </div>
      {ordem.recibo_status === 'devolvido' && ordem.recibo_motivo && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <strong>Recibo devolvido:</strong> {ordem.recibo_motivo}
        </p>
      )}

      <input id={id} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only"
        onChange={e => { escolher(e.target.files?.[0]); e.target.value = '' }} />

      {!arquivo ? (
        <label htmlFor={id}
          className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy py-3 text-base font-semibold text-white hover:bg-navy-light">
          📷 Fotografar recibo
        </label>
      ) : (
        <div className="mt-3 space-y-2">
          {previa ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previa} alt="Prévia do recibo" className="max-h-64 w-full rounded-lg border border-gray-100 object-contain" />
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">📄 {arquivo.name}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label htmlFor={id}
              className="flex cursor-pointer items-center justify-center rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Trocar foto
            </label>
            <button type="button" onClick={enviar} disabled={enviando}
              className="flex items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60">
              {enviando && <Spinner size="sm" />}
              {enviando ? 'Enviando…' : 'Enviar recibo'}
            </button>
          </div>
        </div>
      )}
      {erro && <p role="alert" className="mt-2 text-xs text-red-600">{erro}</p>}
    </li>
  )
}

const hoje = () => new Date().toLocaleDateString('sv-SE')   // AAAA-MM-DD no fuso local
function somarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE')
}
/** Último dia aceito: até 2 meses à frente (a mesma trava da API). */
function dataMaxima() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + 3)
  d.setDate(0)
  return d.toLocaleDateString('sv-SE')
}
const fmtBRL = (v: number | string | null) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

const campo = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-800 placeholder-gray-400 focus:border-navy focus-ring focus:outline-none sm:text-sm'
const rotulo = 'mb-1 block text-sm font-medium text-gray-700'

const VAZIO = { assunto: '', valor: '', data: hoje(), centro: '', descricao: '' }
type CampoForm = keyof typeof VAZIO

export default function OrdemCompraPage() {
  const { session, loading, token, signOut } = useAuth()
  const router = useRouter()
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [centros, setCentros] = useState<CentroCusto[]>([])
  const [funcionarios, setFuncionarios] = useState<Funcionario[] | null>(null)
  const [funcionarioId, setFuncionarioId] = useState('')
  const [verTodas, setVerTodas] = useState(false)
  const [ordens, setOrdens] = useState<Ordem[] | null>(null)
  const [form, setForm] = useState(VAZIO)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [pendentes, setPendentes] = useState<AnexoPendente[]>([])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !session) router.replace('/login?next=/oc')
  }, [loading, session, router])

  const carregarOrdens = useCallback(() => {
    if (!token) return
    api.get<{ items: Ordem[] }>(`/ordens-compra?inicio=${somarDias(hoje(), -180)}&fim=${hoje()}`, token)
      .then(r => setOrdens(r.items))
      .catch(e => { setOrdens([]); setErro(e instanceof Error ? e.message : 'Não foi possível carregar suas solicitações.') })
  }, [token])

  useEffect(() => {
    if (!token) return
    api.get<Usuario>('/usuarios/me', token).then(setUsuario).catch(() => {})
    api.get<CentroCusto[]>('/configuracoes/centros-custo', token).then(setCentros).catch(() => {})
    api.get<Funcionario[]>('/configuracoes/funcionarios', token)
      .then(fs => {
        const ativos = fs.filter(f => f.ativo)
        setFuncionarios(ativos)
        // Celular compartilhado: abre com quem usou da última vez.
        const salvo = typeof window !== 'undefined' ? window.localStorage.getItem(CHAVE_FUNCIONARIO) : null
        if (salvo && ativos.some(f => f.id === salvo)) escolherFuncionario(salvo, ativos)
      })
      .catch(() => setFuncionarios([]))
    carregarOrdens()
  }, [token, carregarOrdens])

  const set = (k: CampoForm, v: string) => { setForm(f => ({ ...f, [k]: v })); setErro(null) }
  const temLista = !!funcionarios?.length
  const funcionario = funcionarios?.find(f => f.id === funcionarioId)

  function escolherFuncionario(id: string, lista = funcionarios ?? []) {
    setFuncionarioId(id)
    setVerTodas(false)
    const f = lista.find(x => x.id === id)
    if (typeof window !== 'undefined') {
      if (id) window.localStorage.setItem(CHAVE_FUNCIONARIO, id)
      else window.localStorage.removeItem(CHAVE_FUNCIONARIO)
    }
    // O centro do funcionário vem preenchido (dá para trocar).
    if (f?.centro_custo) setForm(prev => ({ ...prev, centro: f.centro_custo as string }))
    setErro(null)
  }

  function validar(): string | null {
    if (temLista && !funcionarioId) return 'Escolha seu nome em "Quem é você?".'
    if (form.assunto.trim().length < 2) return 'Diga em poucas palavras o que é (ex.: Gasolina viagem SP).'
    if (!(parseFloat(form.valor) > 0)) return 'Informe o valor.'
    if (!form.data) return 'Informe a data da despesa.'
    if (form.data > dataMaxima()) return 'A data pode ser no máximo 2 meses à frente.'
    if (form.descricao.trim().length < 3) return 'Conte um pouco mais nos detalhes (mínimo 3 letras).'
    return null
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    const problema = validar()
    if (problema) { setErro(problema); return }
    setEnviando(true); setErro(null); setAviso(null)
    const corpo = {
      assunto: form.assunto.trim(), descricao: form.descricao.trim(), valor: parseFloat(form.valor),
      data_prevista: form.data, centro_custo: form.centro || null,
      ...(funcionarioId ? { funcionario_id: funcionarioId } : {}),
    }
    try {
      const ordem = editandoId
        ? await api.patch<Ordem>(`/ordens-compra/${editandoId}`, token, corpo)
        : await api.post<Ordem>('/ordens-compra', token, corpo)
      const falhas = pendentes.length ? await enviarAnexos(token, 'ordem_compra', ordem.id, pendentes) : []
      setForm({ ...VAZIO, data: hoje(), centro: funcionario?.centro_custo ?? '' }); setPendentes([]); setEditandoId(null)
      setAviso(falhas.length
        ? `Solicitação enviada, mas a nota não subiu: ${falhas.join(' ')} Abra a solicitação abaixo e anexe de novo.`
        : 'Solicitação enviada para aprovação. Acompanhe abaixo.')
      carregarOrdens()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível enviar.')
    } finally {
      setEnviando(false)
    }
  }

  function corrigir(o: Ordem) {
    setEditandoId(o.id)
    setForm({
      assunto: o.assunto, valor: o.valor != null ? String(Number(o.valor)) : '',
      data: o.data_prevista ?? o.data_solicitacao, centro: o.centro_custo ?? '', descricao: o.descricao,
    })
    if (o.funcionario_id && funcionarios?.some(f => f.id === o.funcionario_id)) setFuncionarioId(o.funcionario_id)
    setPendentes([]); setErro(null); setAviso(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function excluir(o: Ordem) {
    if (!token || !window.confirm(`Excluir a solicitação "${o.assunto}"?`)) return
    try {
      await api.delete(`/ordens-compra/${o.id}`, token)
      carregarOrdens()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível excluir.')
    }
  }

  async function sair() {
    await signOut()
    router.replace('/login?next=/oc')
  }

  if (loading || !session) {
    return <div className="flex h-screen items-center justify-center bg-canvas"><Spinner size="lg" className="text-navy" /></div>
  }

  const naoColaborador = usuario && usuario.role !== 'colaborador'
  // Com funcionário escolhido, a lista é a dele (o login pode ser compartilhado).
  const filtrar = temLista && !!funcionarioId && !verTodas
  const visiveis = (ordens ?? []).filter(o => !filtrar || o.funcionario_id === funcionarioId)
  const semRecibo = visiveis.filter(faltaRecibo)
  const primeiroNome = (funcionario?.nome ?? usuario?.nome ?? '').split(' ')[0]

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <header className="bg-navy px-4 pb-6 pt-4 text-white">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <Image src="/logo_beige.png" alt="MX Corretora de Seguros" width={96} height={32} className="object-contain" />
          <div className="flex items-center gap-3 text-sm">
            {naoColaborador && <a href="/dashboard" className="text-white/80 underline-offset-2 hover:underline">Painel</a>}
            <button type="button" onClick={sair} className="text-white/80 underline-offset-2 hover:underline">Sair</button>
          </div>
        </div>
        <div className="mx-auto mt-4 max-w-lg">
          <h1 className="text-xl font-semibold">Ordem de Compra</h1>
          <p className="mt-0.5 text-sm text-white/70">
            {primeiroNome ? `Olá, ${primeiroNome}. ` : ''}Lance aqui a despesa que você vai ter ou já teve. Ela vai para aprovação.
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-3 max-w-lg space-y-4 px-4">
        {aviso && <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{aviso}</p>}

        {temLista && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <label htmlFor="oc-func" className={rotulo}>Quem é você?</label>
            <select id="oc-func" value={funcionarioId} onChange={e => escolherFuncionario(e.target.value)} className={campo}>
              <option value="">Escolha seu nome</option>
              {funcionarios!.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
        )}

        {token && semRecibo.length > 0 && (
          <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4" aria-labelledby="falta-recibo">
            <h2 id="falta-recibo" className="font-semibold text-amber-900">🧾 Falta o recibo ({semRecibo.length})</h2>
            <p className="text-xs text-amber-800">Sua ordem foi aprovada. Fotografe o recibo ou a nota da compra e envie.</p>
            <ul className="mt-3 space-y-3">
              {semRecibo.map(o => (
                <EnviarRecibo key={o.id} ordem={o} token={token}
                  onEnviado={msg => { setAviso(msg); carregarOrdens(); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
              ))}
            </ul>
          </section>
        )}

        <form onSubmit={enviar} noValidate className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy">{editandoId ? 'Corrigir solicitação' : 'Nova solicitação'}</h2>
            {editandoId && (
              <button type="button" onClick={() => { setEditandoId(null); setForm({ ...VAZIO, data: hoje() }) }}
                className="text-sm text-gray-500 hover:underline">Cancelar</button>
            )}
          </div>

          <div>
            <label htmlFor="oc-assunto" className={rotulo}>O que é?</label>
            <input id="oc-assunto" value={form.assunto} onChange={e => set('assunto', e.target.value)} maxLength={200}
              placeholder="Ex.: Gasolina viagem SP" className={campo} autoComplete="off" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Valor</label>
              <InputMoeda value={form.valor} onChange={v => set('valor', v)} className="!rounded-xl !py-2.5 !text-base sm:!text-sm" />
            </div>
            <div>
              <label htmlFor="oc-data" className={rotulo}>Data da despesa</label>
              <input id="oc-data" type="date" value={form.data} max={dataMaxima()}
                onChange={e => set('data', e.target.value)} className={campo} />
            </div>
          </div>
          {form.data > hoje() && (
            <p className="-mt-2 text-xs text-gray-500">Despesa futura: tudo bem lançar antes (ex.: viagem de amanhã).</p>
          )}

          <div>
            <label htmlFor="oc-centro" className={rotulo}>Centro de custo <span className="font-normal text-gray-400">(se souber)</span></label>
            <select id="oc-centro" value={form.centro} onChange={e => set('centro', e.target.value)} className={campo}>
              <option value="">Não sei / o financeiro define</option>
              <OpcoesCentro centros={centros} atual={form.centro} />
            </select>
          </div>

          <div>
            <label htmlFor="oc-desc" className={rotulo}>Detalhes</label>
            <textarea id="oc-desc" value={form.descricao} onChange={e => set('descricao', e.target.value)} rows={3}
              maxLength={2000} placeholder="Para quê, onde, quem estava junto…" className={campo} />
          </div>

          {token && (
            <CampoAnexos token={token} entidade="ordem_compra" rotulo="Foto da nota ou comprovante"
              pendentes={pendentes} onPendentes={setPendentes} tipoPadrao="nota_fiscal" />
          )}

          {erro && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

          <button type="submit" disabled={enviando}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-3 text-base font-semibold text-white hover:bg-navy-light disabled:opacity-60">
            {enviando && <Spinner size="sm" />}
            {enviando ? 'Enviando…' : editandoId ? 'Reenviar para aprovação' : 'Enviar para aprovação'}
          </button>
        </form>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-navy">
                {filtrar && funcionario ? `Solicitações de ${funcionario.nome.split(' ')[0]}` : 'Minhas solicitações'}
              </h2>
              <p className="text-xs text-gray-400">Últimos 6 meses</p>
            </div>
            {temLista && funcionarioId && (
              <button type="button" onClick={() => setVerTodas(v => !v)} aria-pressed={verTodas}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${verTodas ? 'bg-navy text-white ring-navy' : 'text-gray-600 ring-gray-200'}`}>
                Ver todas
              </button>
            )}
          </div>
          {ordens === null ? (
            <div className="py-6 text-center"><Spinner className="text-navy" /></div>
          ) : visiveis.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Nenhuma solicitação ainda.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {visiveis.map(o => (
                <li key={o.id} className="py-3">
                  <button type="button" onClick={() => setAberta(a => (a === o.id ? null : o.id))}
                    className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={aberta === o.id}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-800">{o.assunto}</span>
                      <span className="text-xs text-gray-500">
                        {fmtData(o.data_prevista ?? o.data_solicitacao)}
                        {o.centro_custo ? ` · ${nomeCentro(o.centro_custo, centros)}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-semibold tabular-nums text-gray-800">{fmtBRL(o.valor)}</span>
                      <StatusBadge status={o.status} className="px-1.5 py-0 text-[10px]" />
                      <SeloRecibo status={o.recibo_status} className="text-[10px]" />
                    </span>
                  </button>
                  <LinhaDoTempo o={o} />
                  {o.status === 'rejeitada' && o.rejeitado_motivo && (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Motivo: {o.rejeitado_motivo}</p>
                  )}
                  {aberta === o.id && token && (
                    <div className="mt-3 space-y-2">
                      <p className="whitespace-pre-line text-sm text-gray-600">{o.descricao}</p>
                      {verTodas && <p className="text-xs text-gray-500">Funcionário: {o.solicitante}</p>}
                      <CampoAnexos token={token} entidade="ordem_compra" entidadeId={o.id}
                        rotulo="Notas e recibos" somenteLeitura={!!o.despesa_id} />
                      {!o.despesa_id && o.status !== 'aprovada' && (
                        <div className="flex gap-4 pt-1 text-sm">
                          <button type="button" onClick={() => corrigir(o)} className="font-medium text-navy hover:underline">
                            {o.status === 'rejeitada' ? 'Corrigir e reenviar' : 'Editar'}
                          </button>
                          {o.status === 'pendente' && (
                            <button type="button" onClick={() => excluir(o)} className="text-red-600 hover:underline">Excluir</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
