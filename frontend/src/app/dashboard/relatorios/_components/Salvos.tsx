'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { FILTRO_BOTAO } from '@/components/ui/filtros'
import { MODELOS, type Config } from './pivot'

export interface RelatorioSalvo {
  id: string
  nome: string
  config: Config
  dono: string
  dono_nome: string | null
  compartilhado: boolean
  meu: boolean
  atualizado_em: string
}

export interface SalvosResp {
  disponivel: boolean
  aviso: string | null
  itens: RelatorioSalvo[]
  pode_criar: boolean
  pode_compartilhar: boolean
}

const IconPasta = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
)

interface MenuProps {
  salvos: SalvosResp | null
  atualId: string | null
  onSalvo: (r: RelatorioSalvo) => void
  onModelo: (m: Config) => void
}

/** "Abrir": meus relatórios, os da equipe e os modelos prontos, num só menu. */
export function MenuAbrir({ salvos, atualId, onSalvo, onModelo }: MenuProps) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  const meus = salvos?.itens.filter(r => r.meu) ?? []
  const equipe = salvos?.itens.filter(r => !r.meu) ?? []
  const item = (chave: string, texto: React.ReactNode, ativo: boolean, onClick: () => void) => (
    <button key={chave} type="button" role="menuitem" onClick={() => { setAberto(false); onClick() }}
      className={cn('block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-gray-50', ativo ? 'font-semibold text-navy' : 'text-gray-700')}>
      {texto}
    </button>
  )
  const secao = (titulo: string) => (
    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{titulo}</p>
  )

  return (
    <div ref={caixa} className="relative" data-tour="rel-modelos">
      <button type="button" onClick={() => setAberto(a => !a)} className={FILTRO_BOTAO} aria-haspopup="menu" aria-expanded={aberto}>
        <IconPasta /> Abrir relatório
      </button>
      {aberto && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white pb-1 shadow-lg">
          {salvos?.disponivel !== false && (
            <>
              {secao('Meus relatórios')}
              {meus.length ? meus.map(r => item(r.id, <>{r.nome}{r.compartilhado && <span className="ml-1 text-[10px] text-gray-400">· equipe</span>}</>, r.id === atualId, () => onSalvo(r)))
                : <p className="px-3 py-1 text-xs text-gray-400">Nenhum ainda. Monte um e clique em Salvar.</p>}
              {equipe.length > 0 && secao('Da equipe')}
              {equipe.map(r => item(r.id, <>{r.nome}{r.dono_nome && <span className="ml-1 text-[10px] text-gray-400">· {r.dono_nome}</span>}</>, r.id === atualId, () => onSalvo(r)))}
            </>
          )}
          {secao('Modelos prontos')}
          {MODELOS.map(m => item(m.nome, m.nome, false, () => onModelo(m)))}
        </div>
      )}
    </div>
  )
}

interface DialogoProps {
  aberto: boolean
  titulo: string
  nomeInicial: string
  compartilhadoInicial: boolean
  podeCompartilhar: boolean
  salvando: boolean
  erro: string | null
  onCancelar: () => void
  onConfirmar: (nome: string, compartilhado: boolean) => void
}

export function DialogoSalvar({ aberto, titulo, nomeInicial, compartilhadoInicial, podeCompartilhar, salvando, erro, onCancelar, onConfirmar }: DialogoProps) {
  const [nome, setNome] = useState(nomeInicial)
  const [compartilhado, setCompartilhado] = useState(compartilhadoInicial)
  useEffect(() => { if (aberto) { setNome(nomeInicial); setCompartilhado(compartilhadoInicial) } }, [aberto, nomeInicial, compartilhadoInicial])
  const valido = nome.trim().length > 0 && nome.trim().length <= 120

  return (
    <Modal open={aberto} onClose={onCancelar} title={titulo} maxWidth="sm:max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => onConfirmar(nome.trim(), compartilhado)} loading={salvando} disabled={!valido}>Salvar</Button>
        </>
      )}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (valido) onConfirmar(nome.trim(), compartilhado) }}>
        <label className="block text-xs font-medium text-gray-700">
          Nome do relatório
          <input autoFocus value={nome} onChange={e => setNome(e.target.value)} maxLength={120}
            className="mt-1 h-9 w-full rounded-md border border-gray-200 px-2.5 text-sm focus:outline-none focus-ring" />
        </label>
        {podeCompartilhar && (
          <label className="flex items-start gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={compartilhado} onChange={e => setCompartilhado(e.target.checked)} className="mt-0.5 accent-navy" />
            <span>
              Compartilhar com a equipe
              <span className="block text-gray-400">Todos que acessam Relatórios passam a ver; só você altera.</span>
            </span>
          </label>
        )}
        {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{erro}</p>}
      </form>
    </Modal>
  )
}
