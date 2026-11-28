import React, { useState, useEffect, useCallback } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, KeyRound, Package, Users, CreditCard,
  Monitor, History, Settings, Search, Bell, ChevronDown,
  Plus, ShieldCheck, Copy, Check, X, Menu, LogOut,
  TrendingUp, TrendingDown, Clock, CircleCheck, CircleX,
  AlertTriangle, RefreshCw, MoreVertical, LockKeyhole, Loader2,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import {
  auth, api, dashboard, licensesApi, productsApi,
  customersApi, subscriptionsApi, devicesApi, activityApi, settingsApi,
} from './lib/api'

// ------------------------------------------------------------------
// Types & navigation
// ------------------------------------------------------------------
type Page = 'dashboard' | 'licenses' | 'products' | 'customers' | 'subscriptions' | 'devices' | 'activity' | 'settings'
type IconType = LucideIcon
interface NavItem { id: Page; label: string; icon: IconType }

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'licenses', label: 'Licenses', icon: KeyRound },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
  { id: 'devices', label: 'Devices', icon: Monitor },
  { id: 'activity', label: 'Activity Log', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const titles: Record<Page, string> = {
  dashboard: 'Overview', licenses: 'Licenses', products: 'Products', customers: 'Customers',
  subscriptions: 'Subscriptions', devices: 'Devices', activity: 'Activity Log', settings: 'Settings',
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const fmtDate = (v?: string | Date | null) => v ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
const fmtDateTime = (v?: string | Date | null) => v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const timeAgo = (v?: string | Date | null) => {
  if (!v) return '—'
  const diff = Date.now() - new Date(v).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const statusColor = (s: string) => {
  switch (s.toLowerCase()) {
    case 'active': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'expired': return 'bg-red-50 text-red-700 border-red-200'
    case 'suspended': case 'blocked': return 'bg-purple-50 text-purple-700 border-purple-200'
    case 'revoked': return 'bg-rose-50 text-rose-700 border-rose-200'
    case 'inactive': return 'bg-slate-100 text-slate-600 border-slate-200'
    default: return 'bg-slate-100 text-slate-600 border-slate-200'
  }
}

const Badge = ({ status }: { status: string }) => (
  <span className={`badge border ${statusColor(status)}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
    {status}
  </span>
)

const StatCard = ({ label, value, change, icon: Icon, color, positive }: {
  label: string; value: string; change: string; icon: IconType; color: string; positive: boolean
}) => (
  <div className="card p-5 hover:shadow-card-hover transition-shadow">
    <div className="flex items-start justify-between">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}><Icon size={20} /></div>
      <span className={`badge ${positive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
        {positive ? <TrendingUp size={12} className="mr-1" /> : <TrendingDown size={12} className="mr-1" />}
        {change}
      </span>
    </div>
    <p className="mt-4 text-2xl font-bold text-slate-900">{value}</p>
    <p className="mt-1 text-sm text-slate-500">{label}</p>
  </div>
)

const Loading = () => (
  <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
    <Loader2 size={20} className="animate-spin mr-2" /> Loading data…
  </div>
)
const ErrorBox = ({ message }: { message: string }) => (
  <div className="card p-6 text-center text-sm text-red-600">{message}</div>
)

function useApi<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    let live = true
    setLoading(true)
    setError('')
    fn().then((d) => { if (live) setData(d) })
      .catch((e) => { if (live) setError(e?.message || 'Failed to load data') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => reload(), [reload])
  return { data, loading, error, reload }
}

// ------------------------------------------------------------------
// Login screen
// ------------------------------------------------------------------
function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await auth.neonLogin(email, password)
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center shadow-sm"><KeyRound size={20} className="text-white" /></div>
          <div>
            <p className="font-bold text-slate-900">License Manager</p>
            <p className="text-[11px] text-slate-400">Admin Console</p>
          </div>
        </div>
        <form onSubmit={submit} className="card p-7 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Sign in to continue</h1>
            <p className="text-sm text-slate-500 mt-1">Use your administrator account</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Email address</label>
            <input className="input-field" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Password</label>
            <input className="input-field" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <button className="btn-primary w-full flex items-center justify-center gap-2" disabled={busy} onClick={e => submit(e)}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}
            {busy ? 'Signing in…' : 'Sign in with Neon'}
          </button>
          <p className="text-center text-xs text-slate-400">Contact your administrator if you do not have an account.</p>
        </form>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Generate license modal
// ------------------------------------------------------------------
function IssueModal({ onClose, onIssued }: { onClose: () => void; onIssued: () => void }) {
  const [products, setProducts] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [form, setForm] = useState({ productId: '', customerId: '', customerName: '', customerEmail: '', plan: 'pro', days: 365, maxDevices: 2 })
  const [result, setResult] = useState<{ key: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    productsApi.list().then(setProducts).catch(() => {})
    customersApi.list().then(setCustomers).catch(() => {})
  }, [])

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const payload: any = {
        productId: form.productId || undefined,
        customerId: form.customerId || undefined,
        customerName: form.customerName || undefined,
        customerEmail: form.customerEmail || undefined,
        plan: form.plan,
        days: Number(form.days),
        maxDevices: Number(form.maxDevices),
      }
      const r = await licensesApi.issue(payload)
      setResult({ key: r.licenseKey || r.license?.licenseKey || '' })
      onIssued()
    } catch (err: any) {
      setError(err.message || 'Failed to issue license')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div><h3 className="font-semibold text-slate-900">Generate License</h3><p className="text-xs text-slate-500 mt-0.5">Sign a new Ed25519 license token</p></div>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose}><X size={18} /></button>
        </div>
        {result ? (
          <div>
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium mb-3"><CircleCheck size={17} /> License issued successfully</div>
            <p className="text-xs text-slate-500 mb-2">Your license key — share this with your customer</p>
            <div className="flex items-center gap-2 p-4 bg-primary-50 border border-primary-200 rounded-lg">
              <code className="font-mono text-lg font-bold tracking-wider text-primary-700 flex-1">{result.key}</code>
              <button className="shrink-0 text-primary-600 hover:text-primary-800" onClick={() => { navigator.clipboard?.writeText(result.key); setCopied(true) }}>
                {copied ? <Check size={18} className="text-emerald-500" /> : <Copy size={18} />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Format: DIG-XXXX-XXXX-XXXX</p>
            <button className="btn-primary mt-5 w-full" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500">License keys use the format <code className="font-mono font-semibold text-primary-700">DIG-XXXX-XXXX-XXXX</code> (e.g. <code className="font-mono">DIG-8K29-XP71-MQ45</code>)</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Product</label>
                <select className="input-field" value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })}>
                  <option value="">Default product</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Existing customer</label>
                <select className="input-field" value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })}>
                  <option value="">— Create new —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {!form.customerId && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Customer name</label>
                  <input className="input-field" placeholder="Customer name" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Customer email</label>
                  <input className="input-field" type="email" placeholder="billing@acme.com" value={form.customerEmail} onChange={e => setForm({ ...form, customerEmail: e.target.value })} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Plan</label>
                <select className="input-field" value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}>
                  <option value="standard">Standard</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Days</label>
                <input className="input-field" type="number" min={1} value={form.days} onChange={e => setForm({ ...form, days: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Max devices</label>
                <input className="input-field" type="number" min={1} value={form.maxDevices} onChange={e => setForm({ ...form, maxDevices: Number(e.target.value) })} />
              </div>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary flex items-center gap-2" onClick={submit} disabled={busy}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                {busy ? 'Signing…' : 'Generate'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Renew modal — adjustable days + custom absolute expiry
function RenewModal({ license, onClose, onRenewed }: { license: any; onClose: () => void; onRenewed: () => void }) {
  const [mode, setMode] = useState<'days' | 'custom'>('days')
  const [days, setDays] = useState(30)
  const [customExpiry, setCustomExpiry] = useState('')
  const [maxDevices, setMaxDevices] = useState<number>(license?.maxDevices ?? 1)
  const [status, setStatus] = useState('ACTIVE')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const body: any = { maxDevices: Number(maxDevices), status }
      if (mode === 'custom') {
        if (!customExpiry) throw new Error('Choose a custom expiry date')
        body.expiresAt = new Date(customExpiry).toISOString()
      } else {
        body.days = Math.max(1, Number(days) || 30)
      }
      await licensesApi.renew(license.id, body)
      onRenewed()
    } catch (err: any) {
      setError(err.message || 'Failed to renew license')
    } finally {
      setBusy(false)
    }
  }

  // Default custom input to current expiry + 30 days
  useEffect(() => {
    const base = license?.expiresAt ? new Date(license.expiresAt) : new Date()
    base.setDate(base.getDate() + 30)
    setCustomExpiry(base.toISOString().slice(0, 16))
  }, [license])

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div><h3 className="font-semibold text-slate-900">Renew License</h3><p className="text-xs text-slate-500 mt-0.5 font-mono">{license?.licenseKey}</p></div>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div className="flex gap-2">
            <button className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border ${mode === 'days' ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-slate-600 border-slate-200'}`} onClick={() => setMode('days')}>Extend by days</button>
            <button className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border ${mode === 'custom' ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-slate-600 border-slate-200'}`} onClick={() => setMode('custom')}>Custom expiry</button>
          </div>

          {mode === 'days' ? (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Number of days to add</label>
              <input className="input-field w-full" type="number" min={1} value={days} onChange={e => setDays(Number(e.target.value))} />
              <p className="text-[11px] text-slate-400 mt-1">Current expiry: {fmtDate(license?.expiresAt)} — extended from the later of expiry or today</p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">New expiry date & time</label>
              <input className="input-field w-full" type="datetime-local" value={customExpiry} onChange={e => setCustomExpiry(e.target.value)} />
              <p className="text-[11px] text-slate-400 mt-1">Sets an absolute expiry; must be in the future</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Max devices</label>
              <input className="input-field w-full" type="number" min={1} value={maxDevices} onChange={e => setMaxDevices(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Status</label>
              <select className="input-field w-full" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="ACTIVE">Active</option>
                <option value="PENDING">Pending</option>
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary flex items-center gap-2" onClick={submit} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {busy ? 'Renewing…' : 'Renew'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
function Dashboard() {
  const { data: s, loading, error } = useApi(() => dashboard.stats(), [])
  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />
  if (!s) return <ErrorBox message="No data available" />
  const statusData = [
    { name: 'Active', value: s.licenses.active, color: '#10b981' },
    { name: 'Pending', value: s.licenses.pending, color: '#f59e0b' },
    { name: 'Expired', value: s.licenses.expired, color: '#ef4444' },
    { name: 'Expiring soon', value: s.licenses.expiringSoon, color: '#7c5cfc' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <StatCard label="Total Licenses" value={String(s.licenses.total)} change={`${s.changes.licenses > 0 ? '+' : ''}${s.changes.licenses}%`} icon={KeyRound} color="bg-primary-50 text-primary-600" positive={s.changes.licenses >= 0} />
        <StatCard label="Active Licenses" value={String(s.licenses.active)} change={`${s.licenses.expiringSoon} expiring`} icon={CircleCheck} color="bg-emerald-50 text-emerald-600" positive />
        <StatCard label="Registered Devices" value={String(s.devices.total)} change={`${s.changes.devices > 0 ? '+' : ''}${s.changes.devices}%`} icon={Monitor} color="bg-blue-50 text-blue-600" positive={s.changes.devices >= 0} />
        <StatCard label="Customers" value={String(s.customers.total)} change={`${s.changes.customers > 0 ? '+' : ''}${s.changes.customers}%`} icon={Users} color="bg-amber-50 text-amber-600" positive={s.changes.customers >= 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-slate-900">License Activity</h3>
              <p className="text-xs text-slate-500 mt-0.5">Licenses issued and devices activated — last 7 days</p>
            </div>
            <button className="btn-secondary text-xs py-1.5">This week</button>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={s.trend}>
              <defs>
                <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c5cfc" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#7c5cfc" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="renGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Area type="monotone" dataKey="activated" stroke="#7c5cfc" fill="url(#actGrad)" strokeWidth={2} name="Issued" />
              <Area type="monotone" dataKey="renewed" stroke="#10b981" fill="url(#renGrad)" strokeWidth={2} name="Activated" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-slate-900">License Status</h3>
          <p className="text-xs text-slate-500 mt-0.5 mb-2">Distribution by current state</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                {statusData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {statusData.map((e) => (
              <div key={e.name} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />
                <span className="text-xs text-slate-600">{e.name}</span>
                <span className="text-xs font-semibold text-slate-900 ml-auto">{e.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div><h3 className="font-semibold text-slate-900">Recent Licenses</h3><p className="text-xs text-slate-500 mt-0.5">Latest generated license keys</p></div>
          <span className="text-xs text-slate-400">Live from API</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <th className="px-5 py-3">License Key</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Product</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Expires</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {s.recentLicenses.map((l: any) => (
                <tr key={l.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-mono text-xs font-medium text-primary-600">{l.licenseKey}</td>
                  <td className="px-5 py-3 text-slate-700">{l.customer || '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{l.product || '—'}</td>
                  <td className="px-5 py-3"><Badge status={l.status} /></td>
                  <td className="px-5 py-3 text-slate-500">{fmtDate(l.expiresAt)}</td>
                </tr>
              ))}
              {s.recentLicenses.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No licenses yet — generate one to get started</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Licenses
// ------------------------------------------------------------------
function Licenses() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [page, setPage] = useState(1)
  const [showIssue, setShowIssue] = useState(false)
  const [renewLicense, setRenewLicense] = useState<any>(null)
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState('')

  const params: Record<string, string | number> = { page, limit: 12 }
  if (filter !== 'All') params.status = filter.toUpperCase()
  if (query) params.search = query
  const { data, loading, error, reload } = useApi(() => licensesApi.list(params), [page, filter, query])

  const copy = (key: string) => { navigator.clipboard?.writeText(key); setCopied(key); setTimeout(() => setCopied(''), 1500) }
  const act = async (fn: () => Promise<any>) => {
    setNotice('')
    try { await fn(); reload() } catch (e: any) { setNotice(e.message || 'Action failed') }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Licenses</h2>
          <p className="text-sm text-slate-500 mt-0.5">Manage and monitor all license keys</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowIssue(true)}><Plus size={16} /> Generate License</button>
      </div>

      {notice && <div className="card p-3 text-sm text-red-600 bg-red-50 border-red-100">{notice}</div>}
      {showIssue && <IssueModal onClose={() => setShowIssue(false)} onIssued={() => { setShowIssue(false); reload() }} />}
      {renewLicense && <RenewModal license={renewLicense} onClose={() => setRenewLicense(null)} onRenewed={() => { setRenewLicense(null); reload() }} />}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input-field pl-9" placeholder="Search licenses…" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['All', 'Active', 'Pending', 'Expired', 'Revoked'].map(s => (
              <button key={s} onClick={() => { setFilter(s); setPage(1) }} className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${filter === s ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{s}</button>
            ))}
          </div>
        </div>
        {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3">License Key</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">Devices</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Expires</th><th className="px-5 py-3">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data!.data.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-xs font-medium text-primary-600">{l.keyPrefix}</code>
                        <button onClick={() => copy(l.licenseKey)} className="text-slate-400 hover:text-primary-600">{copied === l.licenseKey ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}</button>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{l.customer?.name || '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{l.product?.name || '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{l._count?.devices ?? 0} / {l.maxDevices}</td>
                    <td className="px-5 py-3"><Badge status={l.status} /></td>
                    <td className="px-5 py-3 text-slate-500">{fmtDate(l.expiresAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        {l.status !== 'REVOKED' && (
                          <button title="Revoke" className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200" onClick={() => act(() => licensesApi.revoke(l.id))}>Revoke</button>
                        )}
                        <button title="Renew license" className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200" onClick={() => setRenewLicense(l)}>Renew</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data!.data.length === 0 && <p className="text-center py-10 text-slate-400 text-sm">No licenses found</p>}
          </div>
        )}
        {data && data.pages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Page {data.page} of {data.pages} · {data.total} total</span>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs py-1.5" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <button className="btn-secondary text-xs py-1.5" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Products
// ------------------------------------------------------------------
function Products() {
  const { data, loading, error, reload } = useApi(() => Promise.all([productsApi.list(), productsApi.plans()]), [])
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [form, setForm] = useState({ name: '', code: '', version: '1.0.0', description: '', defaultDeviceLimit: '3' })

  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />
  const [listProducts, listPlans] = data!

  const addProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await productsApi.create({
        name: form.name.trim(),
        code: form.code.trim(),
        version: form.version.trim() || '1.0.0',
        description: form.description.trim() || undefined,
        defaultDeviceLimit: parseInt(form.defaultDeviceLimit, 10) || 3,
      })
      setShowAdd(false)
      setForm({ name: '', code: '', version: '1.0.0', description: '', defaultDeviceLimit: '3' })
      reload()
    } catch (e: any) {
      setErr(e?.message || 'Failed to create product')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-slate-900">Products</h2><p className="text-sm text-slate-500 mt-0.5">Software products under license management</p></div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowAdd(true)}><Plus size={14} /> Add Product</button>
      </div>
      {showAdd && (
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-900">Add Product</h3>
          {err && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <form onSubmit={addProduct} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Product name</label>
              <input className="input-field w-full" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Digith DIG" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Product code (unique)</label>
              <input className="input-field w-full" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. DIG-PRO" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Description</label>
              <textarea className="input-field w-full" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Version</label>
              <input className="input-field w-full" value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="1.0.0" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Default max devices</label>
              <input className="input-field w-full" type="number" min="1" value={form.defaultDeviceLimit} onChange={e => setForm({ ...form, defaultDeviceLimit: e.target.value })} />
            </div>
            <div className="col-span-2 flex items-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => { setShowAdd(false); setErr('') }}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create Product'}</button>
            </div>
          </form>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {listProducts.map(p => (
          <div key={p.id} className="card p-5 hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between">
              <div className="w-11 h-11 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center"><Package size={20} /></div>
              <Badge status={p.isActive ? 'Active' : 'Inactive'} />
            </div>
            <h3 className="mt-4 font-semibold text-slate-900">{p.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Code: {p.code} · v{p.version}</p>
            <p className="text-xs text-slate-500 mt-2">{p.description || 'No description'}</p>
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Max devices: <b className="text-slate-800">{p.defaultDeviceLimit}</b></span>
              <span>Added {fmtDate(p.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="card p-5">
        <h3 className="font-semibold text-slate-900">Subscription Plans</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">Available billing cycles</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {listPlans.map(pl => (
            <div key={pl.id} className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between"><span className="font-medium text-slate-800">{pl.name}</span>{pl.isDefault && <span className="badge bg-primary-50 text-primary-700">Default</span>}</div>
              <p className="text-xs text-slate-500 mt-1">{pl.duration} days · {pl.maxDevices} devices</p>
              <p className="text-xl font-bold text-slate-900 mt-3">${pl.price}<span className="text-xs font-normal text-slate-400">/{pl.currency}</span></p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Customers
// ------------------------------------------------------------------
function Customers() {
  const { data, loading, error } = useApi(() => customersApi.list(), [])
  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-slate-900">Customers</h2><p className="text-sm text-slate-500 mt-0.5">Businesses and individuals holding licenses</p></div>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <th className="px-5 py-3">Customer</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Joined</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data!.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center text-xs font-bold">{c.name.charAt(0)}</div><div><p className="font-medium text-slate-800">{c.name}</p><p className="text-xs text-slate-500">{c.company || '—'}</p></div></div></td>
                  <td className="px-5 py-3 text-slate-600">{c.email}</td>
                  <td className="px-5 py-3 text-slate-500">{c.phone || '—'}</td>
                  <td className="px-5 py-3"><Badge status={c.isActive ? 'Active' : 'Inactive'} /></td>
                  <td className="px-5 py-3 text-slate-500">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data!.length === 0 && <p className="text-center py-10 text-slate-400 text-sm">No customers found</p>}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Subscriptions
// ------------------------------------------------------------------
function Subscriptions() {
  const { data, loading, error } = useApi(() => Promise.all([subscriptionsApi.list(), productsApi.plans()]), [])
  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />
  const [subscriptions, plans] = data!
  const colors = ['from-blue-500 to-cyan-500', 'from-amber-500 to-orange-500', 'from-primary-500 to-purple-600', 'from-emerald-500 to-teal-600']

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-slate-900">Subscriptions</h2><p className="text-sm text-slate-500 mt-0.5">Plans and billing cycles</p></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {plans.map((p, i) => (
          <div key={p.id} className="card overflow-hidden hover:shadow-card-hover transition-shadow">
            <div className={`h-1.5 bg-gradient-to-r ${colors[i % colors.length]}`} />
            <div className="p-5">
              <h3 className="font-semibold text-slate-900">{p.name}</h3>
              <p className="text-xs text-slate-500 mt-1">{p.duration} days · {p.maxDevices} devices</p>
              <p className="mt-4 text-3xl font-bold text-slate-900">${p.price}</p>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">{subscriptions.filter(s => s.planId === p.id).length} subscribers</span>
                <Badge status={p.isActive ? 'Active' : 'Inactive'} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card p-5">
        <h3 className="font-semibold text-slate-900">Active Subscriptions</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">Recent subscription activity</p>
        <div className="space-y-3">
          {subscriptions.slice(0, 6).map(s => (
            <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><CreditCard size={16} /></div><div><p className="text-sm font-medium text-slate-800">{s.product?.name}</p><p className="text-xs text-slate-500">{s.subscriptionPlan?.name} plan · expires {fmtDate(s.expiryDate)}</p></div></div>
              <Badge status={s.status} />
            </div>
          ))}
          {subscriptions.length === 0 && <p className="text-center py-6 text-slate-400 text-sm">No subscriptions found</p>}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Devices
// ------------------------------------------------------------------
function Devices() {
  const [notice, setNotice] = useState('')
  const { data, loading, error, reload } = useApi(() => devicesApi.list(), [])
  const act = async (id: string, status: string) => {
    try { await devicesApi.update(id, { status }); reload() } catch (e: any) { setNotice(e.message || 'Action failed') }
  }
  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />
  const active = data!.filter(d => d.status === 'ACTIVE').length
  const blocked = data!.filter(d => d.status === 'BLOCKED').length

  return (
    <div className="space-y-5">
      <div><h2 className="text-xl font-bold text-slate-900">Devices</h2><p className="text-sm text-slate-500 mt-0.5">Registered device fingerprints and activation status</p></div>
      {notice && <div className="card p-3 text-sm text-red-600 bg-red-50 border-red-100">{notice}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard label="Total Devices" value={String(data!.length)} change="+18.7%" icon={Monitor} color="bg-blue-50 text-blue-600" positive />
        <StatCard label="Active Devices" value={String(active)} change="+9.3%" icon={CircleCheck} color="bg-emerald-50 text-emerald-600" positive />
        <StatCard label="Blocked Devices" value={String(blocked)} change={`${blocked}`} icon={CircleX} color="bg-red-50 text-red-600" positive={false} />
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <th className="px-5 py-3">Fingerprint</th><th className="px-5 py-3">License / Product</th><th className="px-5 py-3">OS</th><th className="px-5 py-3">Last Validated</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data!.map(d => (
                <tr key={d.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-mono text-xs text-slate-700">{d.fingerprint.slice(0, 18)}…</td>
                  <td className="px-5 py-3 text-slate-600">{d.license?.product?.name || '—'}</td>
                  <td className="px-5 py-3 text-slate-500">{d.os || '—'}</td>
                  <td className="px-5 py-3 text-slate-500">{timeAgo(d.lastValidation)}</td>
                  <td className="px-5 py-3"><Badge status={d.status} /></td>
                  <td className="px-5 py-3">
                    <button className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={() => act(d.id, d.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED')}>
                      {d.status === 'BLOCKED' ? 'Unblock' : 'Block'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data!.length === 0 && <p className="text-center py-10 text-slate-400 text-sm">No devices found</p>}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Activity
// ------------------------------------------------------------------
function Activity() {
  const { data, loading, error } = useApi(() => activityApi.list(), [])
  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />
  const iconFor = (action: string) => {
    if (/ACTIVAT|RENEW|ISSUED/.test(action)) return <CircleCheck size={16} className="text-emerald-500" />
    if (/REVOKE|FAIL|DEACTIVAT/.test(action)) return <CircleX size={16} className="text-red-500" />
    if (/LOGIN|VALIDAT/.test(action)) return <Clock size={16} className="text-blue-500" />
    return <AlertTriangle size={16} className="text-amber-500" />
  }
  const labelFor = (a: string) => a.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <div className="space-y-5">
      <div><h2 className="text-xl font-bold text-slate-900">Activity Log</h2><p className="text-sm text-slate-500 mt-0.5">Audit trail of all system operations</p></div>
      <div className="card p-5">
        <div className="flow-root">
          <ul className="-mb-8">
            {data!.map((a, i) => (
              <li key={a.id}>
                <div className="relative pb-8">
                  {i !== data!.length - 1 && <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-slate-100" aria-hidden="true" />}
                  <div className="relative flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center z-10">{iconFor(a.action)}</div>
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-sm font-medium text-slate-800">{labelFor(a.action)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">by {a.userEmail} · {a.entityType}{a.entityId ? ` · ${a.entityId.slice(0, 12)}…` : ''}</p>
                    </div>
                    <time className="text-xs text-slate-400 whitespace-nowrap pt-1">{timeAgo(a.createdAt)}</time>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {data!.length === 0 && <p className="text-center py-10 text-slate-400 text-sm">No activity recorded yet</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------
function SettingsPage() {
  const { data, loading, error, reload } = useApi(() => settingsApi.get(), [])
  const [grace, setGrace] = useState(7)
  const [preset, setPreset] = useState('7')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [apiBase, setApiBase] = useState('/api/v1')
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')

  useEffect(() => {
    if (!data) return
    setGrace(Number(data.offlineGraceDays ?? 7))
    setPreset(['0', '3', '7'].includes(String(data.offlineGraceDays)) ? String(data.offlineGraceDays) : 'custom')
    setApiBase(data.apiBaseUrl || '/api/v1')
  }, [data])

  const save = async () => {
    setSaving(true); setSaveError(''); setSaved(false)
    try {
      await settingsApi.update({
        offlineGraceDays: Math.max(0, Math.floor(grace)),
        apiBaseUrl: apiBase.trim() || '/api/v1',
      })
      reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setSaveError(e.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async () => {
    setPwMsg(''); setPwError('')
    try {
      await api.post('/auth/change-password', pw)
      setPw({ currentPassword: '', newPassword: '' })
      setPwMsg('Password updated successfully')
    } catch (e: any) {
      setPwError(e.message || 'Failed to change password')
    }
  }

  const choosePreset = (value: string) => {
    setPreset(value)
    if (value !== 'custom') setGrace(Number(value))
  }

  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />

  return (
    <div className="space-y-5 max-w-3xl">
      <div><h2 className="text-xl font-bold text-slate-900">Settings</h2><p className="text-sm text-slate-500 mt-0.5">Configure system behavior and security</p></div>
      {saved && <div className="card p-3 text-sm text-emerald-600 bg-emerald-50 border-emerald-100 flex items-center gap-2"><Check size={16} /> Settings saved to the server</div>}
      {saveError && <div className="card p-3 text-sm text-red-600 bg-red-50 border-red-100">{saveError}</div>}
      <div className="card p-5 space-y-5">
        <div>
          <h3 className="font-semibold text-slate-900">Signing Key</h3>
          <p className="text-xs text-slate-500 mt-1">Ed25519 key pair used to sign license tokens and offline license files</p>
          <div className="mt-3 flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="w-9 h-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center"><ShieldCheck size={18} /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">Ed25519 Signing Key</p>
              <p className="text-xs font-mono text-slate-500 truncate">{data?.publicKeyFingerprint || '—'}</p>
            </div>
            <Badge status="Active" />
          </div>
          {data?.publicKey && (
            <details className="mt-2"><summary className="text-xs text-primary-600 cursor-pointer">View public key PEM (embed in the desktop app)</summary>
              <pre className="mt-2 p-3 bg-slate-50 rounded-lg text-[10px] font-mono text-slate-600 whitespace-pre-wrap break-all">{data.publicKey}</pre>
            </details>
          )}
        </div>
        <div className="border-t border-slate-100 pt-5">
          <h3 className="font-semibold text-slate-900">Offline Grace Period</h3>
          <p className="text-xs text-slate-500 mt-1">How long a desktop app may run offline after its last successful server validation. Never extends the subscription expiry.</p>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[['0', 'Disabled'], ['3', '3 days'], ['7', '7 days'], ['custom', 'Custom']].map(([value, label]) => (
              <button key={value} onClick={() => choosePreset(value)}
                className={`px-3 py-2 rounded-lg border text-sm ${preset === value ? 'border-primary-300 bg-primary-50 text-primary-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="mt-3 flex items-center gap-3"><input type="number" min={0} max={3650} value={grace} onChange={e => setGrace(Number(e.target.value))} className="input-field w-28" /><span className="text-sm text-slate-600">days</span></div>
          )}
        </div>
        <div className="border-t border-slate-100 pt-5">
          <h3 className="font-semibold text-slate-900">API Configuration</h3>
          <p className="text-xs text-slate-500 mt-1">Base URL for license activation, validation and synchronization (HTTPS in production)</p>
          <input className="input-field mt-3" value={apiBase} onChange={e => setApiBase(e.target.value)} />
          <p className="text-[11px] text-slate-400 mt-2">Offline client endpoints: <code className="font-mono">/offline/activate</code>, <code className="font-mono">/offline/sync</code>, <code className="font-mono">/offline/time</code></p>
        </div>
        <div className="border-t border-slate-100 pt-5">
          <h3 className="font-semibold text-slate-900">Change Password</h3>
          <p className="text-xs text-slate-500 mt-1">Replace your initial password with one only you know</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <input className="input-field" type="password" placeholder="Current password" value={pw.currentPassword} onChange={e => setPw({ ...pw, currentPassword: e.target.value })} />
            <input className="input-field" type="password" placeholder="New password (min 8 characters)" value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} />
          </div>
          {pwMsg && <p className="text-sm text-emerald-600 mt-2">{pwMsg}</p>}
          {pwError && <p className="text-sm text-red-600 mt-2">{pwError}</p>}
          <button className="btn-secondary mt-3" onClick={changePassword} disabled={!pw.currentPassword || pw.newPassword.length < 8}>Update Password</button>
        </div>
        <div className="border-t border-slate-100 pt-5 flex justify-end">
          <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// App shell
// ------------------------------------------------------------------
export default function App() {
  const [authenticated, setAuthenticated] = useState(() => auth.isAuthenticated())
  const [page, setPage] = useState<Page>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { data: me } = useApi(
    () => auth.isAuthenticated() ? api.get<any>('/auth/me') : Promise.resolve(null),
    [authenticated],
  )

  if (!authenticated) return <LoginScreen onSuccess={() => setAuthenticated(true)} />
  const initials = (me?.name || me?.email || '?').split(/[\s@]/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard />
      case 'licenses': return <Licenses />
      case 'products': return <Products />
      case 'customers': return <Customers />
      case 'subscriptions': return <Subscriptions />
      case 'devices': return <Devices />
      case 'activity': return <Activity />
      case 'settings': return <SettingsPage />
    }
  }

  const logout = () => { auth.logout(); setAuthenticated(false) }

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 flex items-center px-5 border-b border-slate-200 gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center shadow-sm"><KeyRound size={18} className="text-white" /></div>
          <div>
            <p className="font-bold text-slate-900 text-sm leading-tight">License Manager</p>
            <p className="text-[10px] text-slate-400">Admin Console</p>
          </div>
          <button className="ml-auto lg:hidden text-slate-400" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Menu</p>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => { setPage(id); setSidebarOpen(false) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${page === id ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Icon size={18} /> {label}
              {page === id && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500" />}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200">
          <div className="p-3 rounded-lg bg-gradient-to-br from-primary-50 to-purple-50 border border-primary-100">
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-primary-600" /><span className="text-xs font-semibold text-primary-900">Ed25519 Signed</span></div>
            <p className="text-[11px] text-primary-700/70 mt-1">Keys stored on this server</p>
          </div>
          <button className="w-full mt-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50" onClick={logout}><LogOut size={18} /> Sign Out</button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-slate-900/40 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="lg:pl-64">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-4 sm:px-6 sticky top-0 z-10">
          <button className="mr-3 text-slate-500 lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">{titles[page]}</h1>
            <p className="text-[11px] text-slate-500">Welcome back, here's what's happening</p>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="relative hidden sm:block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="w-52 pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500/20" placeholder="Search…" />
            </div>
            <button className="relative w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"><Bell size={17} /><span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white" /></button>
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">{initials}</div>
              <div className="hidden sm:block"><p className="text-xs font-semibold text-slate-800">{me?.name || 'User'}</p><p className="text-[10px] text-slate-500">{me?.email || '—'}</p></div>
              <ChevronDown size={14} className="text-slate-400" />
            </div>
          </div>
        </header>

        <main className="p-4 sm:p-6 max-w-[1600px] mx-auto">{renderPage()}</main>

        <footer className="px-6 py-4 text-center text-[11px] text-slate-400 border-t border-slate-200">
          License Management System · v1.0.0 · Admin Console
        </footer>
      </div>
    </div>
  )
}
