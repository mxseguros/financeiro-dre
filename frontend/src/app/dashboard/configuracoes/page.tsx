'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/contexts/UserContext'
import { permissaoPagamentos } from '@/types'
import { cn } from '@/lib/utils'
import { SecaoUsuarios } from './_components/SecaoUsuarios'
import { SecaoCategoriasSubitens } from './_components/SecaoCategoriasSubitens'
import { SecaoBancos } from './_components/SecaoBancos'
import { SecaoCentros } from './_components/SecaoCentros'
import { SecaoFuncionarios } from './_components/SecaoFuncionarios'
import { SecaoClassificacoes } from './_components/SecaoClassificacoes'
import { SecaoFornecedores } from './_components/SecaoFornecedores'
import { SecaoContasPagadoras } from './_components/SecaoContasPagadoras'
import { SecaoIA } from './_components/SecaoIA'

type Aba = 'usuarios' | 'categorias' | 'classificacoes' | 'bancos' | 'centros' | 'funcionarios' | 'fornecedores' | 'contas_pagadoras' | 'ia'

export default function ConfiguracoesPage() {
  const { token, session, signOut } = useAuth()
  const { role, permissions } = useUser()
  const router = useRouter()

  const podeCriar   = permissions?.configuracoes?.criar    ?? false
  const podeEditar  = permissions?.configuracoes?.editar   ?? false
  const podeExcluir = permissions?.configuracoes?.deletar  ?? false

  const currentUserId = session?.user?.id ?? null

  // Redesenho UX (fase 7): menu à esquerda em 4 grupos; cada seção com endereço próprio (?secao=).
  const GRUPOS_TODOS: { titulo: string; itens: { id: Aba; label: string; desc: string; admin?: boolean }[] }[] = [
    { titulo: 'Acesso', itens: [
      { id: 'usuarios', label: 'Usuários', desc: 'Quem acessa o sistema e o que cada um pode fazer' },
    ] },
    { titulo: 'Estrutura', itens: [
      { id: 'categorias', label: 'Categorias e subitens', desc: 'Categorias e subitens de despesas e receitas' },
      { id: 'classificacoes', label: 'Classificações', desc: 'Opções do campo Classificação dos lançamentos (Fixa, Variável…)' },
      { id: 'centros', label: 'Centros de custo', desc: 'Unidades e filiais, em grupo › subgrupo' },
      { id: 'bancos', label: 'Bancos', desc: 'Contas bancárias da corretora' },
    ] },
    { titulo: 'Pessoas', itens: [
      { id: 'funcionarios', label: 'Funcionários', desc: 'Quem lança Ordem de Compra pelo link /oc, com o centro de custo de cada um' },
      { id: 'fornecedores', label: 'Fornecedores', desc: 'Favorecidos dos pagamentos: CPF/CNPJ, chave Pix e conta. Os funcionários são editados no contrato.' },
    ] },
    { titulo: 'Pagamentos', itens: [
      { id: 'contas_pagadoras', label: 'Contas pagadoras', desc: 'Contas da empresa de onde saem os pagamentos por arquivo (CNAB), com convênio e opções do banco', admin: true },
    ] },
    { titulo: 'Integrações', itens: [
      { id: 'ia', label: 'Assistente de IA', desc: 'Chave da API da Anthropic usada pelo Assistente, Copiloto e sugestões do extrato (guardada criptografada)', admin: true },
    ] },
  ]
  // Pagamentos (0050): quem gera remessa gerencia fornecedores; contas, só o Admin.
  const podePagamentos = permissaoPagamentos(permissions, role, 'remessa')
  // Contas pagadoras e Assistente de IA: só o Admin.
  const GRUPOS = GRUPOS_TODOS.map(g => ({ ...g, itens: g.itens.filter(i => !i.admin || role === 'admin') })).filter(g => g.itens.length)
  const ABAS = GRUPOS.flatMap(g => g.itens)

  const [aba, setAbaEstado] = useState<Aba>('usuarios')
  // No celular a lista de seções é a tela inicial; tocar abre a seção (com Voltar).
  const [abertaCelular, setAbertaCelular] = useState(false)
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('secao') as Aba | null
    if (s && ABAS.some(a => a.id === s)) { setAbaEstado(s); setAbertaCelular(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])
  function setAba(a: Aba) {
    setAbaEstado(a)
    setAbertaCelular(true)
    window.history.replaceState(null, '', `${window.location.pathname}?secao=${a}`)
  }

  async function handleSelfDeleted() {
    await signOut()
    router.push('/login')
  }

  if (!token || !role) return null

  const abaAtual = ABAS.find(a => a.id === aba) ?? ABAS[0]

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start">
      {/* Menu das seções: à esquerda no desktop; tela inicial no celular */}
      <nav data-tour="cfg-abas" aria-label="Seções de Configurações"
        className={cn('shrink-0 rounded-2xl border border-gray-200 bg-white p-2 md:sticky md:top-24 md:block md:w-[220px]', abertaCelular ? 'hidden' : 'block')}>
        {GRUPOS.map(g => (
          <div key={g.titulo} className="mb-2 last:mb-0">
            <p className="px-3 pb-1 pt-2 text-[13px] font-semibold text-slate-500">{g.titulo}</p>
            <ul>
              {g.itens.map(i => (
                <li key={i.id}>
                  <button type="button" onClick={() => setAba(i.id)} aria-current={aba === i.id ? 'page' : undefined}
                    className={cn('focus-ring flex min-h-12 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-[15px] md:min-h-11 md:text-sm',
                      aba === i.id ? 'bg-sel-bg font-semibold text-sel-text' : 'text-slate-700 hover:bg-slate-50')}>
                    {i.label}
                    {i.admin && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px] font-medium text-slate-600">Admin</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('min-w-0 flex-1 space-y-4 md:block', abertaCelular ? 'block' : 'hidden')}>
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => setAbertaCelular(false)} aria-label="Voltar para as seções"
            className="focus-ring -ml-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-xl text-slate-700 hover:bg-slate-100 md:hidden">‹</button>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{abaAtual.label}</h2>
            <p className="text-[13px] text-slate-600 md:text-sm">{abaAtual.desc}</p>
          </div>
        </div>

      {aba === 'usuarios' && (
        <SecaoUsuarios
          token={token} role={role} podeExcluir={podeExcluir}
          currentUserId={currentUserId} onSelfDeleted={handleSelfDeleted}
        />
      )}
      {aba === 'categorias' && (
        <SecaoCategoriasSubitens token={token} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} />
      )}
      {aba === 'classificacoes' && (
        <SecaoClassificacoes token={token} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} />
      )}
      {aba === 'bancos' && (
        <SecaoBancos token={token} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} />
      )}
      {aba === 'centros' && (
        <SecaoCentros token={token} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} />
      )}
      {aba === 'funcionarios' && (
        <SecaoFuncionarios token={token} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir}
          ehAdmin={role === 'admin'} />
      )}
      {aba === 'fornecedores' && <SecaoFornecedores token={token} podeGerenciar={podePagamentos} />}
      {aba === 'contas_pagadoras' && role === 'admin' && <SecaoContasPagadoras token={token} />}
      {aba === 'ia' && role === 'admin' && <SecaoIA token={token} />}
      </div>
    </div>
  )
}
