'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { limparPeriodoSalvo } from '@/contexts/PeriodoContext'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CAMPO_TEXTO, CampoSenha, ErroCampo, LogoAcesso, MolduraAcesso } from '@/components/auth/CampoSenha'

/** Volta para onde a pessoa estava (ex.: o link /oc). Só caminho interno. */
function destinoAposLogin(): string {
  if (typeof window === 'undefined') return '/dashboard'
  const next = new URLSearchParams(window.location.search).get('next') ?? ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
}

type Modo = 'entrar' | 'esqueci' | 'enviado'

const rotulo = 'block text-sm font-semibold text-slate-700'
const botaoPrimario = 'focus-ring h-[52px] w-full rounded-xl bg-navy text-base font-semibold text-white transition hover:bg-navy-light disabled:opacity-60 md:h-12 md:text-[15px]'
const link = 'focus-ring inline-flex min-h-[44px] items-center rounded text-[15px] font-semibold text-sel hover:text-sel-text hover:underline md:min-h-0 md:text-[13px]'

/**
 * Login (redesenho UX, fase 2 — spec §3): uma coluna, rótulos ligados aos
 * campos, Mostrar senha, erro em texto abaixo do campo e "Esqueci minha senha"
 * pelo fluxo de redefinição do Supabase (página /redefinir-senha).
 */
export default function LoginPage() {
  const { signIn } = useAuth()
  const router = useRouter()
  const [modo, setModo] = useState<Modo>('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  // Erro de acesso: `campo` diz onde a mensagem aparece; credencial errada marca os dois campos.
  const [erro, setErro] = useState<{ campo: 'email' | 'senha'; msg: string; ambos?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const campoSenha = useRef<HTMLInputElement>(null)
  const campoEmail = useRef<HTMLInputElement>(null)

  function trocar(m: Modo) {
    setErro(null)
    setModo(m)
    window.setTimeout(() => campoEmail.current?.focus(), 0)
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!validarEmail()) return
    if (!senha) { setErro({ campo: 'senha', msg: 'Informe a senha.' }); campoSenha.current?.focus(); return }
    setLoading(true)
    const { data, error } = await signIn(email.trim(), senha)
    if (error) {
      // 400 = credenciais erradas; o resto é falha de rede/servidor.
      setErro(error.status === 400
        ? { campo: 'senha', msg: 'E-mail ou senha incorretos. Confira e tente de novo.', ambos: true }
        : { campo: 'senha', msg: 'Não foi possível conectar agora. Tente de novo em instantes.' })
      setLoading(false)
      campoSenha.current?.focus()
      return
    }
    // Entrar sempre começa no mês atual, mesmo se a sessão anterior expirou sem logout.
    limparPeriodoSalvo()
    // Colaborador (0047) só usa a Ordem de Compra: vai direto para /oc.
    let destino = destinoAposLogin()
    try {
      const token = data.session?.access_token
      if (token) {
        const eu = await api.get<{ role: string }>('/usuarios/me', token)
        if (eu.role === 'colaborador') destino = '/oc'
      }
    } catch { /* sem o perfil, segue para o destino padrão */ }
    router.push(destino)
  }

  /** Validação nossa (o formulário usa noValidate): erro em português, abaixo do campo. */
  function validarEmail(): boolean {
    const v = email.trim()
    const msg = !v ? 'Informe o seu e-mail.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Confira o e-mail: falta algo como nome@empresa.com.br.' : null
    if (msg) { setErro({ campo: 'email', msg }); campoEmail.current?.focus() }
    return !msg
  }

  async function enviarLink(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!validarEmail()) return
    setLoading(true)
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    setLoading(false)
    if (error) {
      setErro({ campo: 'email', msg: error.status === 429
        ? 'Muitos pedidos seguidos. Espere alguns minutos e tente de novo.'
        : 'Não foi possível enviar o e-mail agora. Tente de novo em instantes.' })
      return
    }
    // O Supabase não diz se o e-mail existe (evita descobrir quem tem conta).
    setModo('enviado')
  }

  const erroId = 'erro-acesso'
  const emailInvalido = erro?.campo === 'email' || !!erro?.ambos
  const senhaInvalida = erro?.campo === 'senha'

  return (
    <MolduraAcesso>
      <LogoAcesso />

      <div className="flex flex-1 flex-col md:flex-none md:rounded-2xl md:border md:border-gray-200 md:bg-white md:p-8 md:shadow-lg">
        {modo === 'entrar' && (
          <form onSubmit={entrar} noValidate className="flex flex-1 flex-col">
            <h1 className="text-2xl font-bold text-slate-900 md:text-[22px]">Entrar no MX DRE-IA</h1>
            <p className="mt-1.5 text-[15px] text-slate-600 md:text-sm">Use o e-mail e a senha que o administrador cadastrou para você.</p>

            <div className="mt-7 space-y-5">
              <div>
                <label htmlFor="email" className={rotulo}>E-mail</label>
                <input
                  ref={campoEmail}
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@mxseguros.com.br"
                  aria-invalid={emailInvalido || undefined}
                  aria-describedby={emailInvalido ? erroId : undefined}
                  className={cn(CAMPO_TEXTO, 'mt-1.5', emailInvalido ? 'border-2 border-red-700' : 'border-gray-300')}
                />
                {erro?.campo === 'email' && <ErroCampo id={erroId}>{erro.msg}</ErroCampo>}
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="senha" className={rotulo}>Senha</label>
                  <button type="button" onClick={() => trocar('esqueci')} className={cn(link, 'hidden md:inline-flex')}>
                    Esqueci minha senha
                  </button>
                </div>
                <CampoSenha
                  ref={campoSenha}
                  id="senha"
                  required
                  autoComplete="current-password"
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  invalido={senhaInvalida}
                  aria-describedby={senhaInvalida ? erroId : undefined}
                  className="mt-1.5"
                />
                {senhaInvalida && <ErroCampo id={erroId}>{erro.msg}</ErroCampo>}
              </div>

              <button type="button" onClick={() => trocar('esqueci')} className={cn(link, 'md:hidden')}>
                Esqueci minha senha
              </button>
            </div>

            {/* No celular o botão fica embaixo, perto do polegar. */}
            <div className="flex-1 md:hidden" />
            <div className="mt-8 md:mt-7">
              <button type="submit" disabled={loading} className={botaoPrimario}>
                {loading ? 'Entrando…' : 'Entrar'}
              </button>
              <p className="mt-4 text-center text-[13px] text-slate-600">
                Ainda não tem acesso? Peça ao administrador para convidar você.
              </p>
            </div>
          </form>
        )}

        {modo === 'esqueci' && (
          <form onSubmit={enviarLink} noValidate className="flex flex-1 flex-col">
            <h1 className="text-2xl font-bold text-slate-900 md:text-[22px]">Redefinir a senha</h1>
            <p className="mt-1.5 text-[15px] text-slate-600 md:text-sm">
              Informe o seu e-mail. Enviaremos um link para você criar uma senha nova.
            </p>

            <div className="mt-7">
              <label htmlFor="email" className={rotulo}>E-mail</label>
              <input
                ref={campoEmail}
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@mxseguros.com.br"
                aria-invalid={emailInvalido || undefined}
                aria-describedby={emailInvalido ? erroId : undefined}
                className={cn(CAMPO_TEXTO, 'mt-1.5', emailInvalido ? 'border-2 border-red-700' : 'border-gray-300')}
              />
              {erro && <ErroCampo id={erroId}>{erro.msg}</ErroCampo>}
            </div>

            <div className="flex-1 md:hidden" />
            <div className="mt-8 space-y-2 md:mt-7">
              <button type="submit" disabled={loading} className={botaoPrimario}>
                {loading ? 'Enviando…' : 'Enviar link'}
              </button>
              <button type="button" onClick={() => trocar('entrar')}
                className="focus-ring h-12 w-full rounded-xl text-[15px] font-semibold text-slate-700 hover:bg-gray-50 md:h-11">
                Voltar para entrar
              </button>
            </div>
          </form>
        )}

        {modo === 'enviado' && (
          <div className="flex flex-1 flex-col" role="status">
            <h1 className="text-2xl font-bold text-slate-900 md:text-[22px]">Confira o seu e-mail</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-700 md:text-sm">
              Se <strong className="font-semibold text-slate-900">{email.trim()}</strong> estiver cadastrado, você vai receber
              em alguns minutos um link para criar uma senha nova.
            </p>
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-900">
              Abra o link <strong className="font-semibold">neste mesmo navegador</strong>. Se não chegar, olhe a caixa de spam.
            </p>
            <div className="flex-1 md:hidden" />
            <button type="button" onClick={() => trocar('entrar')} className={cn(botaoPrimario, 'mt-8 md:mt-7')}>
              Voltar para entrar
            </button>
          </div>
        )}
      </div>
    </MolduraAcesso>
  )
}
