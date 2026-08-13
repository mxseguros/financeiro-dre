const stripBom = (s: string) => s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
const BASE = stripBom(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

/** URL base da API — única fonte para todo o frontend. */
export const API_BASE = BASE

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
    if (typeof window !== 'undefined') window.location.href = '/login'
    throw new Error('Sessão expirada. Faça login novamente.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body?.detail ?? body?.erro
    throw new Error(typeof detail === 'string' && detail ? detail : `HTTP ${res.status}`)
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
