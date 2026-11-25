import type { Permissions } from '@/types'

/** Permissões antigas sem "relatorios" mostram o que valia antes (o "Ver" do Monitor). */
const relatoriosDe = (p: Permissions) =>
  p.relatorios ?? { visualizar: !!p.assistente?.visualizar, criar: !!p.assistente?.visualizar, compartilhar: false }

// ── Configuração de telas e ações para os checkboxes ──────────
const TELAS_CONFIG: Array<{
  id: keyof Permissions
  label: string
  acoes: Array<{ key: string; label: string }>
}> = [
  { id: 'visao_geral',   label: 'Visão Geral',   acoes: [{ key: 'visualizar', label: 'Ver' }] },
  { id: 'dre',           label: 'DRE',            acoes: [{ key: 'visualizar', label: 'Ver' }] },
  { id: 'lancamentos',   label: 'Lançamentos',    acoes: [
    { key: 'visualizar', label: 'Ver' },
    { key: 'criar',      label: 'Criar' },
    { key: 'editar',     label: 'Editar' },
    { key: 'deletar',    label: 'Deletar' },
  ]},
  { id: 'aprovacoes',    label: 'Aprovações',     acoes: [
    { key: 'visualizar', label: 'Ver' },
    { key: 'aprovar',    label: 'Aprovar' },
  ]},
  { id: 'relatorios',    label: 'Relatórios',     acoes: [
    { key: 'visualizar',   label: 'Ver' },
    { key: 'criar',        label: 'Salvar' },
    { key: 'compartilhar', label: 'Compartilhar' },
  ]},
  { id: 'pagamentos',    label: 'Pagamentos',     acoes: [
    { key: 'visualizar', label: 'Ver' },
    { key: 'remessa',    label: 'Gerar remessa' },
    { key: 'retorno',    label: 'Importar retorno' },
  ]},
  { id: 'configuracoes', label: 'Configurações',  acoes: [
    { key: 'visualizar', label: 'Ver' },
    { key: 'criar',      label: 'Criar' },
    { key: 'editar',     label: 'Editar' },
    { key: 'deletar',    label: 'Deletar' },
  ]},
]

export function PermissoesSelector({
  permissions,
  onChange,
}: {
  permissions: Permissions
  onChange: (p: Permissions) => void
}) {
  function toggle(tela: keyof Permissions, acao: string) {
    const atual = tela === 'relatorios' ? relatoriosDe(permissions) : permissions[tela]
    const current = (atual as Record<string, boolean>)[acao] ?? false
    onChange({
      ...permissions,
      [tela]: { ...atual, [acao]: !current },
    })
  }

  return (
    <div className="col-span-1 sm:col-span-2 lg:col-span-4 rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="border-b border-gray-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Permissões de Acesso</p>
      </div>
      <div className="divide-y divide-gray-50">
        {TELAS_CONFIG.map(tela => (
          <div key={tela.id} className="flex items-center gap-3 px-3 py-2">
            <span className="w-28 shrink-0 text-xs font-medium text-gray-700">{tela.label}</span>
            <div className="flex flex-wrap gap-3">
              {tela.acoes.map(acao => {
                const valores = tela.id === 'relatorios' ? relatoriosDe(permissions) : permissions[tela.id]
                const checked = (valores as Record<string, boolean>)?.[acao.key] ?? false
                return (
                  <label key={acao.key} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(tela.id, acao.key)}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-navy focus:ring-navy"
                    />
                    <span className="text-xs text-gray-600">{acao.label}</span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
