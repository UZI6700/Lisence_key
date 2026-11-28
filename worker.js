/* Cloudflare Worker entrypoint for the License Management API.
 * Bundled to ESM by scripts/bundle-worker.js. Uses Neon's HTTP serverless
 * driver so no raw TCP sockets are needed inside the isolate. */
import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './packages/api/dist/app.module.js';

/* Cloudflare Workers (via unenv) has no http.createServer. Nest's ExpressAdapter
 * creates one in its constructor but never needs it to listen. Stub it out. */
import * as nodeHttp from 'node:http';
const httpModule = nodeHttp.default || nodeHttp;
if (httpModule && typeof httpModule.createServer === 'function') {
  httpModule.createServer = () => ({
    on() { return this; }, once() { return this; }, emit() { return false; },
    listen() { return this; }, close() { return this; }, address() { return null; },
    setTimeout() { return this; }, keepAliveTimeout: 0,
  });
}

let serverPromise;

function bootstrap(env) {
  if (!serverPromise) {
    // Expose Worker secrets/vars as process.env for libraries that read it.
    for (const [k, v] of Object.entries(env || {})) {
      if (typeof v === 'string' && /^[A-Z0-9_]+$/.test(k)) process.env[k] = v;
    }
    serverPromise = (async () => {
      const expressServer = express();
      const app = await NestFactory.create(AppModule, new ExpressAdapter(expressServer), {
        logger: ['error', 'warn'],
      });
      app.enableCors({ origin: true, methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', optionsSuccessStatus: 204 });
      await app.init();
      return expressServer;
    })();
  }
  return serverPromise;
}

/* --- Web Request -> Node-ish req ---------------------------------------- */
function toNodeRequest(request) {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const req = {
    method: request.method,
    url: url.pathname + url.search,
    originalUrl: url.pathname + url.search,
    path: url.pathname,
    headers,
    httpVersion: '1.1', httpVersionMajor: 1, httpVersionMinor: 1,
    connection: {}, socket: { remoteAddress: request.headers.get('cf-connecting-ip') || '127.0.0.1' },
    on() { return this; }, once() { return this; }, emit() { return this; },
  };
  return req;
}

/* --- Node-ish res -> Web Response --------------------------------------- */
function toWebResponse(out) {
  const headers = out.headers;
  headers['content-type'] = headers['content-type'] || 'application/json';
  return new Response(out.status >= 200 && out.status < 300 ? out.body : out.body, {
    status: out.status,
    headers,
  });
}

async function dispatch(server, request) {
  const req = toNodeRequest(request);
  const raw = await request.arrayBuffer();
  const bodyText = raw.byteLength ? new TextDecoder().decode(raw) : '';

  // Express body parsers read from the stream; we inject parsed JSON directly.
  if (bodyText) {
    try { req.body = JSON.parse(bodyText); } catch { req.body = bodyText; }
  }

  const out = { status: 200, headers: {}, body: new Uint8Array(), ended: false };
  const res = {
    get statusCode() { return out.status; },
    set statusCode(v) { out.status = v; },
    status(v) { out.status = v; return this; },
    setHeader(k, v) { out.headers[k.toLowerCase()] = String(v); return this; },
    getHeader(k) { return out.headers[k.toLowerCase()]; },
    removeHeader(k) { delete out.headers[k.toLowerCase()]; return this; },
    getHeaders() { return { ...out.headers }; },
    headersSent: false,
    writeHead(code, h) {
      out.status = code;
      if (h && typeof h === 'object') for (const [k, v] of Object.entries(h)) out.headers[k.toLowerCase()] = String(v);
      return this;
    },
    write(chunk) { /* buffered below */ return true; },
    end(chunk) {
      if (chunk) {
        if (typeof chunk === 'string') out.body = new TextEncoder().encode(chunk);
        else if (chunk instanceof Uint8Array) out.body = chunk;
        else out.body = new TextEncoder().encode(JSON.stringify(chunk));
      }
      out.ended = true;
    },
    json(body) { out.headers['content-type'] = 'application/json'; this.end(JSON.stringify(body)); return this; },
    send(body) {
      if (body && typeof body === 'object') return this.json(body);
      this.end(body == null ? '' : String(body));
      return this;
    },
    redirect(url) { out.status = 302; out.headers.location = url; this.end(); return this; },
    on() { return this; }, once() { return this; }, emit() { return this; },
  };

  await new Promise((resolve, reject) => {
    try {
      const r = server(req, res);
      if (r && typeof r.then === 'function') r.then(resolve, reject);
      else resolve();
    } catch (e) { reject(e); }
  });
  // Express may finish synchronously via res.end; give microtasks a tick.
  await new Promise((r) => setTimeout(r, 0));
  return toWebResponse(out);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', runtime: 'cloudflare-worker', timestamp: new Date().toISOString() }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    try {
      const server = await bootstrap(env);
      const response = await dispatch(server, request);
      ctx.waitUntil(Promise.resolve());
      return response;
    } catch (error) {
      return new Response(JSON.stringify({ statusCode: 500, message: error?.message || 'Worker error' }), {
        status: 500, headers: { 'content-type': 'application/json' },
      });
    }
  },
};
