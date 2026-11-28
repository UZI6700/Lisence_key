/* Cloudflare Worker entrypoint.
 * Serves the React dashboard from Workers Assets and proxies /api/* to the
 * live NestJS API on Vercel (which connects to Neon). This avoids Workers'
 * I/O limitations with raw TCP/WebSocket database drivers.
 */
const API_ORIGIN = 'https://license-management-system-three.vercel.app';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health: report worker status without touching the API.
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', runtime: 'cloudflare-worker', timestamp: new Date().toISOString() }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // Proxy every API call to the live backend.
    if (url.pathname.startsWith('/api/')) {
      const target = new URL(url.pathname + url.search, API_ORIGIN);
      const init = {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      };
      try {
        const res = await fetch(target, init);
        const headers = new Headers(res.headers);
        headers.set('access-control-allow-origin', '*');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      } catch (e) {
        return new Response(JSON.stringify({ statusCode: 502, message: 'Upstream API unavailable', detail: e?.message }), {
          status: 502, headers: { 'content-type': 'application/json' },
        });
      }
    }

    // Static dashboard assets.
    if (env.ASSETS) {
      try {
        const asset = await env.ASSETS.fetch(request);
        if (asset && asset.status !== 404) return asset;
      } catch { /* fall through */ }
    }

    return new Response('Not found', { status: 404 });
  },
};
