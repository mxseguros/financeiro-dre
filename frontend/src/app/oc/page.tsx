'use client'
// Link fácil de Ordem de Compra para os funcionários da MX (24/11/2026).
//
// O funcionário (perfil Colaborador) entra por /oc — dá para salvar na tela
// inicial do celular — e lança a despesa que vai ter, com foto da nota:
// "viajo amanhã para SP, R$ 150 de gasolina". A ordem vai para Aprovações;
// aprovada, vira despesa a pagar no mês da data prevista.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Spinner } from '@/components/ui/Button'
import { CampoAnexos, enviarAnexos, type AnexoPendente } from '@/components/anexos/CampoAnexos'
import { OpcoesCentro, nomeCentro, type CentroCusto } from '@/lib/centros'
import type { Usuario } from '@/types'

interface Ordem {
  id: string; solicitante: string; assunto: string; descricao: string
  valor: number | string | null; data_solicitacao: string; data_prevista: string | null
  centro_custo: string | null; status: string; rejeitado_motivo: string | null
  despesa_id: string | null
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

export default function OrdemCompraPage() {
  const { session, loading, token, signOut } = useAuth()
  const router = useRouter()
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [centros, setCentros] = useState<CentroCusto[]>([])
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
    carregarOrdens()
  }, [token, carregarOrdens])

  const set = (k: keyof typeof VAZIO, v: string) => { setForm(f => ({ ...f, [k]: v })); setErro(null) }

  function validar(): string | null {
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
    }
    try {
      const ordem = editandoId
        ? await api.patch<Ordem>(`/ordens-compra/${editandoId}`, token, corpo)
        : await api.post<Ordem>('/ordens-compra', token, corpo)
      const falhas = pendentes.length ? await enviarAnexos(token, 'ordem_compra', ordem.id, pendentes) : []
      setForm({ ...VAZIO, data: hoje() }); setPendentes([]); setEditandoId(null)
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
            {usuario?.nome ? `Olá, ${usuario.nome.split(' ')[0]}. ` : ''}Lance aqui a despesa que você vai ter ou já teve. Ela vai para aprovação.
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-3 max-w-lg space-y-4 px-4">
        {aviso && <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{aviso}</p>}

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
          <h2 className="font-semibold text-navy">Minhas solicitações</h2>
          <p className="text-xs text-gray-400">Últimos 6 meses</p>
          {ordens === null ? (
            <div className="py-6 text-center"><Spinner className="text-navy" /></div>
          ) : ordens.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Nenhuma solicitação ainda.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {ordens.map(o => (
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
                    </span>
                  </button>
                  {o.status === 'rejeitada' && o.rejeitado_motivo && (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Motivo: {o.rejeitado_motivo}</p>
                  )}
                  {aberta === o.id && token && (
                    <div className="mt-3 space-y-2">
                      <p className="whitespace-pre-line text-sm text-gray-600">{o.descricao}</p>
                      <CampoAnexos token={token} entidade="ordem_compra" entidadeId={o.id}
                        rotulo="Notas e comprovantes" somenteLeitura={!!o.despesa_id} />
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
