// Central API client for the License Management backend.

const BASE = '/api/v1'

type TokenPair = { accessToken: string; refreshToken: string }

const getTokens = (): TokenPair | null => {
  try {
    const raw = localStorage.getItem('lm_auth')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const setTokens = (tokens: TokenPair | null) => {
  if (tokens) localStorage.setItem('lm_auth', JSON.stringify(tokens))
  else localStorage.removeItem('lm_auth')
}

export const auth = {
  isAuthenticated: () => !!getTokens()?.accessToken,
  tokens: getTokens,
  logout: () => setTokens(null),
  async neonLogin(email: string, password: string) {
    const res = await fetch(`${BASE}/auth/neon-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || 'Neon sign-in failed')
    }
    const data = await res.json()
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
    return data
  },
}

async function refreshAccess(): Promise<boolean> {
  const tokens = getTokens()
  if (!tokens?.refreshToken) return false
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    })
    if (!res.ok) return false
    const data = await res.json()
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
    return true
  } catch {
    return false
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const tokens = getTokens()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  }
  if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`

  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (res.status === 401 && retry && tokens?.refreshToken) {
    if (await refreshAccess()) return request<T>(path, init, false)
    auth.logout()
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// ------------------------------------------------------------------
// Domain helpers
// ------------------------------------------------------------------
export const dashboard = {
  stats: () => api.get<any>('/stats/dashboard'),
}

export const licensesApi = {
  list: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    return api.get<{ data: any[]; total: number; page: number; pages: number }>(`/licenses${qs ? `?${qs}` : ''}`)
  },
  stats: () => api.get<any>('/licenses/stats'),
  issue: (body: any) => api.post<{ licenseKey: string; token: string; license: any }>('/licenses/issue', body),
  validate: (body: any) => api.post<any>('/licenses/validate', body),
  activate: (body: any) => api.post<any>('/licenses/activate', body),
  revoke: (id: string) => api.post<any>(`/licenses/${id}/revoke`),
  renew: (id: string, days: number) => api.post<any>(`/licenses/${id}/renew`, { days }),
  transferDevice: (id: string, fingerprint: string) => api.post<any>(`/offline/transfer/${id}`, { fingerprint }),
  remove: (id: string) => api.delete<any>(`/licenses/${id}`),
}

export const settingsApi = {
  get: () => api.get<any>('/settings'),
  update: (body: { offlineGraceDays?: number; licenseFileVersion?: number; apiBaseUrl?: string }) =>
    api.patch<any>('/settings', body),
}

export const offlineApi = {
  config: () => api.get<any>('/offline/config'),
  clock: () => api.get<any>('/offline/time'),
  activate: (body: any) => api.post<any>('/offline/activate', body),
  validate: (body: any) => api.post<any>('/offline/validate', body),
  sync: (body: any) => api.post<any>('/offline/sync', body),
}

export const productsApi = {
  list: () => api.get<any[]>('/products'),
  plans: () => api.get<any[]>('/products/plans'),
  create: (body: any) => api.post<any>('/products', body),
  update: (id: string, body: any) => api.patch<any>(`/products/${id}`, body),
  remove: (id: string) => api.delete<any>(`/products/${id}`),
}

export const customersApi = {
  list: () => api.get<any[]>('/customers'),
  create: (body: any) => api.post<any>('/customers', body),
  update: (id: string, body: any) => api.patch<any>(`/customers/${id}`, body),
  remove: (id: string) => api.delete<any>(`/customers/${id}`),
}

export const subscriptionsApi = {
  list: () => api.get<any[]>('/subscriptions'),
  create: (body: any) => api.post<any>('/subscriptions', body),
}

export const devicesApi = {
  list: () => api.get<any[]>('/devices'),
  update: (id: string, body: any) => api.patch<any>(`/devices/${id}`, body),
  remove: (id: string) => api.delete<any>(`/devices/${id}`),
}

export const activityApi = {
  list: () => api.get<any[]>('/activity'),
}
