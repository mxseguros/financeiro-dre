const stripBom = (s: string) => s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
const BASE = stripBom(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

/** URL base da API — única fonte para todo o frontend. */
export const API_BASE = BASE

const ROTULOS_CAMPO: Record<string, string> = {
  descricao: 'Descrição',
  subcategoria: 'Descrição',
  valor: 'Valor',
  competencia: 'Competência',
  data_vencimento: 'Data de vencimento',
  paga_em: 'Data de pagamento',
  num_parcelas: 'Nº de parcelas',
  repetir_ate: 'Repetir até',
  centro_custo: 'Centro de custo',
  categoria: 'Categoria',
}

/**
 * Erros de schema do FastAPI/Pydantic chegam com `detail` em lista
 * ([{loc, msg}]), não em texto — antes viravam só "HTTP 422" na tela.
 */
function formatarErrosValidacao(detail: unknown): string {
  if (!Array.isArray(detail)) return ''
  const linhas = detail.map((d: { loc?: unknown[]; msg?: string }) => {
    const loc = d?.loc ?? []
    const campo = String(loc[loc.length - 1] ?? '')
    const msg = String(d?.msg ?? '')
      .replace(/^Value error, /, '')
      .replace(/String should have at least (\d+) characters?/, 'deve ter no mínimo $1 caracteres')
      .replace(/String should have at most (\d+) characters?/, 'deve ter no máximo $1 caracteres')
      .replace(/Input should be less than or equal to (\S+)/, 'deve ser no máximo $1')
      .replace(/Input should be greater than or equal to (\S+)/, 'deve ser no mínimo $1')
      .replace(/^Field required$/, 'é obrigatório')
    const rotulo = ROTULOS_CAMPO[campo]
    return rotulo ? `${rotulo}: ${msg}` : msg
  })
  return [...new Set(linhas.filter(Boolean))].join(' · ')
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    // fetch() rejeita com TypeError ("Failed to fetch") em falha de rede/CORS/servidor offline
    throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.')
  }
  if (res.status === 401) {
    // Sessão expirada ou revogada no Supabase (ex.: "Session from session_id
    // claim in JWT does not exist"). Encerra a sessão local e volta ao login,
    // em vez de exibir o erro técnico em cada ação.
    try {
      const { createClient } = await import('./supabase')
      await createClient().auth.signOut()
    } catch { /* segue para o redirect mesmo se o signOut falhar */ }
    if (typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
    }
    throw new Error('Sessão expirada. Faça login novamente.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body?.detail ?? body?.erro
    throw new Error(typeof detail === 'string' && detail ? detail : formatarErrosValidacao(detail) || `HTTP ${res.status}`)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as unknown as T
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, token: string) => request<T>(path, token),
  post: <T>(path: string, token: string, body: unknown) =>
    request<T>(path, token, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, token: string, body: unknown) =>
    request<T>(path, token, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, token: string, body: unknown) =>
    request<T>(path, token, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string, token: string, params?: Record<string, string>) => {
    const url = params ? `${path}?${new URLSearchParams(params).toString()}` : path
    return request<T>(url, token, { method: 'DELETE' })
  },
}

// O streaming do chat é feito diretamente na página do Assistente via
// fetch POST /chat com header Authorization (sem token na URL).
