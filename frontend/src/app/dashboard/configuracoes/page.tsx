'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/contexts/UserContext'
import { SecaoUsuarios } from './_components/SecaoUsuarios'
import { SecaoCategoriasSubitens } from './_components/SecaoCategoriasSubitens'
import { SecaoBancos } from './_components/SecaoBancos'
import { SecaoCentros } from './_components/SecaoCentros'
import { SecaoClassificacoes } from './_components/SecaoClassificacoes'

type Aba = 'usuarios' | 'categorias' | 'classificacoes' | 'bancos' | 'centros'

export default function ConfiguracoesPage() {
  const { token, session, signOut } = useAuth()
  const { role, permissions } = useUser()
  const router = useRouter()

  const podeCriar   = permissions?.configuracoes?.criar    ?? false
  const podeEditar  = permissions?.configuracoes?.editar   ?? false
  const podeExcluir = permissions?.configuracoes?.deletar  ?? false

  const currentUserId = session?.user?.id ?? null

  const ABAS: { id: Aba; label: string; desc: string }[] = [
    { id: 'usuarios',   label: 'Usuários',              desc: 'Gerencie os acessos ao sistema' },
    { id: 'categorias', label: 'Categorias de Lançamento', desc: 'Categorias e subitens de despesas e receitas' },
    { id: 'classificacoes', label: 'Classificações', desc: 'Opções do campo Classificação dos subitens de despesas e receitas' },
    { id: 'bancos',     label: 'Bancos',                desc: 'Contas bancárias da corretora' },
    { id: 'centros',    label: 'Centros de Custo',      desc: 'Unidades e filiais' },
  ]

  const [aba, setAba] = useState<Aba>('usuarios')

  async function handleSelfDeleted() {
    await signOut()
    router.push('/login')
  }

  if (!token || !role) return null

  const abaAtual = ABAS.find(a => a.id === aba) ?? ABAS[0]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-navy md:text-2xl">Configurações</h1>
        <p className="mt-0.5 text-sm text-gray-500">Gerencie os parâmetros do sistema</p>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm sm:flex">
        {ABAS.map(a => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={`rounded-lg px-2 py-2.5 text-xs font-medium transition-colors sm:flex-1 sm:px-3 sm:text-sm ${
              aba === a.id ? 'bg-navy text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}>
            {a.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400">{abaAtual.desc}</p>

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
    </div>
  )
}
