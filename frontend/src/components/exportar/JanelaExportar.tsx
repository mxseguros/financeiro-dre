'use client'
import { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { cn, fmtBRL } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { filtroDoPeriodo, usePeriodo } from '@/contexts/PeriodoContext'
import { useUser } from '@/contexts/UserContext'
import { useAuth } from '@/hooks/useAuth'
import { baixarBlob, baixarDoServidor, carregarTabela, imprimir, paraCsv, textoWhatsApp, type Alvo, type Formato, type Tabela } from './dados'

const ALVOS: [Alvo, string, string][] = [
  ['dre', 'DRE', 'Previsto x realizado do mês de referência'],
  ['visao', 'Visão Geral', 'Receitas, despesas e saldo por banco'],
  ['lancamentos', 'Lançamentos', 'Despesas e receitas do período, com os filtros da tela'],
]
const FORMATOS: [Formato, string, string][] = [
  ['xlsx', 'Excel', 'Planilha para abrir no Excel'],
  ['pdf', 'PDF', 'Para imprimir ou anexar'],
  ['png', 'Imagem', 'Arquivo .png da prévia'],
  ['whatsapp', 'WhatsApp', 'Imagem e resumo em texto'],
]
const ROTULO_BOTAO: Record<Formato, string> = { xlsx: 'Baixar Excel', pdf: 'Baixar PDF', png: 'Baixar imagem', whatsapp: 'Enviar no WhatsApp' }

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()

/**
 * Exportar e compartilhar (redesenho UX, fase 8 — spec §12): uma janela só,
 * aberta pelo Exportar da barra do topo em qualquer tela. Desktop: blocos
 * numerados + prévia ao lado. Celular: folha que sobe de baixo com "O quê" e
 * quatro botões grandes (usa o compartilhar do aparelho quando existe).
 */
export function JanelaExportar({ aberta, alvoInicial, onFechar }: { aberta: boolean; alvoInicial: Alvo; onFechar: () => void }) {
  const { token } = useAuth()
  const { role } = useUser()
  const ehAdmin = role === 'admin'
  const periodo = usePeriodo()
  const filtro = filtroDoPeriodo(periodo, true)
  const [alvo, setAlvo] = useState<Alvo>(alvoInicial)
  const [formato, setFormato] = useState<Formato>('xlsx')
  // Quem não é Admin já recebe salários agregados da API: a caixa vem marcada e travada.
  const [esconder, setEsconder] = useState(true)
  const [alterarPeriodo, setAlterarPeriodo] = useState(false)
  const [tabela, setTabela] = useState<Tabela | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const previa = useRef<HTMLDivElement>(null)

  useEffect(() => { if (aberta) { setAlvo(alvoInicial); setAviso(null); setErro(null) } }, [aberta, alvoInicial])

  useEffect(() => {
    if (!aberta || !token) return
    let vivo = true
    setCarregando(true); setErro(null)
    carregarTabela(alvo, token, filtro.qs, periodo.mesInicio, esconder || !ehAdmin)
      .then(t => { if (vivo) setTabela(t) })
      .catch(e => { if (vivo) { setTabela(null); setErro(e instanceof Error ? e.message : 'Não foi possível carregar os dados.') } })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [aberta, token, alvo, filtro.qs, periodo.mesInicio, esconder, ehAdmin])

  const rotuloAlvo = ALVOS.find(a => a[0] === alvo)![1]
  const periodoTexto = alvo === 'dre' ? `Mês de referência ${periodo.mesInicio.slice(5, 7)}/${periodo.mesInicio.slice(0, 4)}` : filtro.rotulo
  const ext = formato === 'xlsx' ? (alvo === 'dre' ? 'xlsx' : 'csv') : formato === 'pdf' ? 'pdf' : 'png'
  const nomeArquivo = `${slug(rotuloAlvo)}_${slug(alvo === 'dre' ? periodo.mesInicio : filtro.rotulo)}${esconder || !ehAdmin ? '' : '_com-confidenciais'}.${ext}`

  async function gerarImagem(): Promise<File> {
    if (!previa.current) throw new Error('Prévia indisponível.')
    const dataUrl = await toPng(previa.current, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true })
    const blob = await (await fetch(dataUrl)).blob()
    return new File([blob], nomeArquivo.replace(/\.\w+$/, '.png'), { type: 'image/png' })
  }

  async function executar(f: Formato = formato) {
    if (!token || !tabela) return
    setEnviando(true); setErro(null); setAviso(null)
    try {
      if (f === 'xlsx' || f === 'pdf') {
        if (alvo === 'dre') await baixarDoServidor(f, token, `${periodo.mesInicio}-01`, filtroDoPeriodo({ ...periodo, modo: 'mes' }).fim, nomeArquivo.replace(/\.\w+$/, `.${f}`))
        else if (f === 'xlsx') baixarBlob(paraCsv(tabela), nomeArquivo.replace(/\.\w+$/, '.csv'))
        else imprimir(tabela, periodoTexto)
        setAviso(f === 'pdf' && alvo !== 'dre' ? 'Abrimos a impressão: escolha "Salvar como PDF".' : 'Arquivo baixado.')
      } else {
        const arquivo = await gerarImagem()
        const texto = textoWhatsApp(tabela, periodoTexto)
        const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
        if (nav.canShare && nav.canShare({ files: [arquivo] })) {
          await navigator.share(f === 'whatsapp' ? { files: [arquivo], text: texto, title: rotuloAlvo } : { files: [arquivo], title: rotuloAlvo })
        } else if (f === 'whatsapp') {
          baixarBlob(arquivo, arquivo.name)
          window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer')
          setAviso('Imagem baixada e WhatsApp aberto com o resumo: anexe a imagem na conversa.')
        } else {
          baixarBlob(arquivo, arquivo.name)
          setAviso('Imagem baixada.')
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setErro(e instanceof Error ? e.message : 'Não foi possível exportar.')
    } finally { setEnviando(false) }
  }

  async function copiarLink() {
    try { await navigator.clipboard.writeText(window.location.href); setAviso('Link da tela copiado.') }
    catch { setErro('Não foi possível copiar o link.') }
  }

  const cartao = (sel: boolean) => cn('focus-ring flex min-h-12 flex-col justify-center rounded-xl border px-3.5 py-2 text-left md:min-h-11',
    sel ? 'border-2 border-sel bg-sel-bg' : 'border-gray-300 bg-white hover:bg-gray-50')
  const passo = (n: number, titulo: string) => (
    <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[13px] text-white">{n}</span>{titulo}
    </h3>
  )

  const prevLinhas = tabela?.linhas.slice(0, 8) ?? []
  const Previa = (
    <div ref={previa} className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">MX Seguros</p>
      <p className="text-base font-bold text-slate-900">{tabela?.titulo ?? rotuloAlvo}</p>
      <p className="text-[13px] text-slate-600">{periodoTexto}</p>
      {carregando ? <p className="py-6 text-sm text-slate-600">Carregando…</p> : tabela && (
        <table className="mt-3 w-full text-[13px]">
          <tbody>
            {prevLinhas.map((l, i) => {
              const textos = l.filter(v => typeof v === 'string' && v) as string[]
              const valor = l[l.length - 1]
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className="max-w-0 truncate py-1.5 pr-2 text-slate-800">{alvo === 'lancamentos' ? textos.slice(2, 3).concat(textos.slice(0, 1)).join(' · ') : textos[0]}</td>
                  <td className={cn('whitespace-nowrap py-1.5 text-right tabular-nums', Number(valor) < 0 ? 'text-red-700' : 'text-slate-900')}>
                    {typeof valor === 'number' ? fmtBRL(alvo === 'dre' ? Number(l[2]) : valor) : valor}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {tabela.total && (
            <tfoot>
              <tr className="border-t-2 border-slate-900 font-bold">
                <td className="py-1.5">{tabela.total.rotulo}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtBRL(tabela.total.valor)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
      {tabela && tabela.linhas.length > prevLinhas.length && <p className="mt-2 text-[13px] text-slate-600">…e mais {tabela.linhas.length - prevLinhas.length} linha(s) no arquivo.</p>}
    </div>
  )

  return (
    <Modal open={aberta} onClose={onFechar} title="Exportar e compartilhar" variant="sheet" maxWidth="sm:max-w-[960px]" dismissable={!enviando}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={copiarLink} className="hidden md:inline-flex">Copiar link da tela</Button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onFechar} disabled={enviando} className="hidden md:inline-flex">Cancelar</Button>
          <Button onClick={() => executar()} loading={enviando} disabled={!tabela || carregando} className="hidden md:inline-flex">{ROTULO_BOTAO[formato]}</Button>
          <Button variant="secondary" onClick={onFechar} disabled={enviando} className="w-full md:hidden">Fechar</Button>
        </div>
      }>
      <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <section>
            {passo(1, 'O que exportar')}
            <div role="radiogroup" aria-label="O que exportar" className="grid grid-cols-3 gap-2">
              {ALVOS.map(([k, r, d]) => (
                <button key={k} type="button" role="radio" aria-checked={alvo === k} onClick={() => setAlvo(k)} className={cn(cartao(alvo === k), 'min-w-0 items-center text-center md:items-start md:text-left')}>
                  <span className={cn('text-sm font-semibold', alvo === k ? 'text-sel-text' : 'text-slate-900')}>{r}</span>
                  <span className="hidden text-[13px] text-slate-600 md:block">{d}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            {passo(2, 'Período e centro')}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-slate-50 px-3.5 py-2.5">
              <span className="text-sm text-slate-800"><b>{periodoTexto}</b> · todos os centros</span>
              <button type="button" onClick={() => setAlterarPeriodo(v => !v)} aria-expanded={alterarPeriodo}
                className="focus-ring h-11 rounded-lg px-2 text-sm font-semibold text-sel hover:underline">{alterarPeriodo ? 'Fechar' : 'Alterar'}</button>
            </div>
            {alterarPeriodo && <div className="mt-2"><SeletorPeriodo intervaloMeses={alvo === 'lancamentos'} /></div>}
          </section>

          <section className="hidden md:block">
            {passo(3, 'Formato')}
            <div role="radiogroup" aria-label="Formato" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {FORMATOS.map(([k, r, d]) => (
                <button key={k} type="button" role="radio" aria-checked={formato === k} onClick={() => setFormato(k)} className={cartao(formato === k)}>
                  <span className={cn('text-sm font-semibold', formato === k ? 'text-sel-text' : 'text-slate-900')}>
                    {r}{k === 'xlsx' && <span className="font-normal text-slate-600"> ({alvo === 'dre' ? '.xlsx' : '.csv'})</span>}
                  </span>
                  <span className="text-[13px] text-slate-600">{d}</span>
                </button>
              ))}
            </div>
          </section>

          <label className="flex min-h-11 items-center gap-3 text-sm text-slate-800">
            <input type="checkbox" checked={esconder || !ehAdmin} disabled={!ehAdmin} onChange={e => setEsconder(e.target.checked)} className="h-5 w-5 accent-navy" />
            <span>Esconder itens confidenciais{!ehAdmin && <span className="block text-[13px] text-slate-600">Só o Admin pode exportar o detalhe de salários.</span>}</span>
          </label>

          {/* Celular: quatro botões grandes (exportam direto) */}
          <div className="grid grid-cols-2 gap-2 md:hidden">
            {FORMATOS.map(([k, r]) => (
              <button key={k} type="button" disabled={!tabela || carregando || enviando} onClick={() => { setFormato(k); executar(k) }}
                className={cn('focus-ring h-14 rounded-xl text-base font-semibold disabled:opacity-50',
                  k === 'whatsapp' ? 'bg-navy text-white' : 'border border-gray-300 bg-white text-slate-900')}>
                {r}
              </button>
            ))}
          </div>

          {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">{erro}</p>}
          {aviso && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-[13px] text-green-900">{aviso}</p>}
        </div>

        <aside aria-label="Prévia" className="min-w-0 space-y-2">
          <p className="text-sm font-bold text-slate-900">Prévia</p>
          {Previa}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] text-slate-600">
            <dt>Arquivo</dt><dd className="truncate font-medium text-slate-800" title={nomeArquivo}>{nomeArquivo}</dd>
            <dt>Linhas</dt><dd className="font-medium text-slate-800">{tabela ? tabela.linhas.length : '—'}</dd>
          </dl>
        </aside>
      </div>
    </Modal>
  )
}
