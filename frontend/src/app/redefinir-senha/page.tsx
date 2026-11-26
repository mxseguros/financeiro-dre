'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/Button'
import { CampoSenha, ErroCampo, LogoAcesso, MolduraAcesso } from '@/components/auth/CampoSenha'

const MIN = 8
const rotulo = 'block text-sm font-semibold text-slate-700'
const botaoPrimario = 'focus-ring h-[52px] w-full rounded-xl bg-navy text-base font-semibold text-white transition hover:bg-navy-light disabled:opacity-60 md:h-12 md:text-[15px]'

type Estado = 'verificando' | 'pronto' | 'invalido' | 'salvo'

/**
 * Destino do link "Esqueci minha senha" (redesenho UX, fase 2).
 *
 * O cliente do Supabase (`@supabase/ssr`) usa PKCE: o link volta com `?code=`,
 * que só pode ser trocado por uma sessão no MESMO navegador que pediu a
 * redefinição (o verificador fica guardado nele). Com a sessão de recuperação
 * ativa, a pessoa grava a senha nova com `auth.updateUser`.
 */
export default function RedefinirSenhaPage() {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>('verificando')
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState<{ campo: 'senha' | 'confirma'; msg: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const campoSenha = useRef<HTMLInputElement>(null)
  const campoConfirma = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createClient()
    let vivo = true
    ;(async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      // O cliente pode já ter trocado o código ao iniciar; confere antes.
      let { data: { session } } = await supabase.auth.getSession()
      if (!session && code) {
        const r = await supabase.auth.exchangeCodeForSession(code)
        session = r.data.session
      }
      if (!vivo) return
      // Tira o código da barra de endereço (não serve mais e não deve ir para histórico/print).
      if (code) window.history.replaceState(null, '', window.location.pathname)
      setEstado(session ? 'pronto' : 'invalido')
    })()
    return () => { vivo = false }
  }, [])

  useEffect(() => { if (estado === 'pronto') campoSenha.current?.focus() }, [estado])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (senha.length < MIN) {
      setErro({ campo: 'senha', msg: `A senha precisa ter pelo menos ${MIN} caracteres.` })
      campoSenha.current?.focus()
      return
    }
    if (senha !== confirma) {
      setErro({ campo: 'confirma', msg: 'As duas senhas não são iguais.' })
      campoConfirma.current?.focus()
      return
    }
    setSalvando(true)
    const { error } = await createClient().auth.updateUser({ password: senha })
    setSalvando(false)
    if (error) {
      const msg = error.code === 'same_password' ? 'A senha nova precisa ser diferente da anterior.'
        : error.code === 'weak_password' ? 'Senha fraca demais. Use letras e números, com pelo menos 8 caracteres.'
        : error.status === 401 || error.status === 403 ? 'O link expirou. Peça um novo na tela de entrada.'
        : 'Não foi possível salvar a senha agora. Tente de novo em instantes.'
      setErro({ campo: 'senha', msg })
      campoSenha.current?.focus()
      return
    }
    setEstado('salvo')
  }

  return (
    <MolduraAcesso>
      <LogoAcesso />

      <div className="flex flex-1 flex-col md:flex-none md:rounded-2xl md:border md:border-gray-200 md:bg-white md:p-8 md:shadow-lg">
        {estado === 'verificando' && (
          <div role="status" className="flex items-center gap-3 py-6 text-[15px] text-slate-700">
            <Spinner className="text-navy" /> Conferindo o link…
          </div>
        )}

        {estado === 'invalido' && (
          <div className="flex flex-1 flex-col" role="alert">
            <h1 className="text-2xl font-bold text-slate-900 md:text-[22px]">Link inválido ou expirado</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-700 md:text-sm">
              O link de redefinição vale por pouco tempo e só funciona no navegador em que você pediu.
              Peça um novo e abra o e-mail neste mesmo navegador.
            </p>
            <div className="flex-1 md:hidden" />
            <button type="button" onClick={() => router.replace('/login')} className={cn(botaoPrimario, 'mt-8 md:mt-7')}>
              Voltar para entrar
            </button>
          </div>
        )}

        {estado === 'pronto' && (
          <form onSubmit={salvar} noValidate className="flex flex-1 flex-col">
            <h1 className="text-2xl font-bold text-slate-900 md:text-[22px]">Criar uma senha nova</h1>
            <p className="mt-1.5 text-[15px] text-slate-600 md:text-sm">Pelo menos {MIN} caracteres. Evite a senha antiga.</p>

            <div className="mt-7 space-y-5">
              <div>
                <label htmlFor="nova" className={rotulo}>Senha nova</label>
                <CampoSenha ref={campoSenha} id="nova" required minLength={MIN} autoComplete="new-password"
                  value={senha} onChange={e => setSenha(e.target.value)}
                  invalido={erro?.campo === 'senha'} aria-describedby={erro?.campo === 'senha' ? 'erro-nova' : undefined}
                  className="mt-1.5" />
                {erro?.campo === 'senha' && <ErroCampo id="erro-nova">{erro.msg}</ErroCampo>}
              </div>
              <div>
                <label htmlFor="confirma" className={rotulo}>Repita a senha nova</label>
                <CampoSenha ref={campoConfirma} id="confirma" required autoComplete="new-password"
                  value={confirma} onChange={e => setConfirma(e.target.value)}
                  invalido={erro?.campo === 'confirma'} aria-describedby={erro?.campo === 'confirma' ? 'erro-confirma' : undefined}
                  className="mt-1.5" />
                {erro?.campo === 'confirma' && <ErroCampo id="erro-confirma">{erro.msg}</ErroCampo>}
              </div>
            </div>

            <div className="flex-1 md:hidden" />
            <button type="submit" disabled={salvando} className={cn(botaoPrimario, 'mt-8 md:mt-7')}>
              {salvando ? 'Salvando…' : 'Salvar senha'}
            </button>
          </form>
        )}

        {estado === 'salvo' && (
          <div className="flex flex-1 flex-col" role="status">
            <h1 className="text-2xl font-bold text-slate-900 md:text-[22px]">Senha alterada</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-700 md:text-sm">
              Pronto. A partir de agora, use a senha nova para entrar.
            </p>
            <div className="flex-1 md:hidden" />
            <button type="button" onClick={() => router.replace('/dashboard')} className={cn(botaoPrimario, 'mt-8 md:mt-7')}>
              Continuar para o sistema
            </button>
          </div>
        )}
      </div>
    </MolduraAcesso>
  )
}
