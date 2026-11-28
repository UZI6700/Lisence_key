/* Side-effect module: imported BEFORE express / @nestjs / prisma.
 * 1) Cloudflare Workers (unenv) has no http.createServer. Nest's ExpressAdapter
 *    creates one in its constructor but never needs it to listen.
 * 2) Neon's WebSocket pool is request-bound in Workers; force HTTP fetch mode.
 */
import * as nodeHttp from 'node:http';
import { ExpressAdapter } from '@nestjs/platform-express';
import { neonConfig } from '@neondatabase/serverless';

const httpModule = nodeHttp.default || nodeHttp;
if (httpModule && !httpModule.__cfPatched) {
  httpModule.__cfPatched = true;
  httpModule.createServer = () => ({
    on() { return this; }, once() { return this; }, emit() { return false; },
    listen() { return this; }, close() { return this; }, address() { return null; },
    setTimeout() { return this; }, keepAliveTimeout: 0,
  });
}

const proto = ExpressAdapter.prototype;
if (proto && !proto.__cfPatched) {
  proto.__cfPatched = true;
  proto.registerHttpServer = function () { return this; };
  proto.initHttpServer = function () { return this; };
  proto.getHttpServer = function () { return this.getInstance(); };
}

// Neon serverless: use plain HTTP (fetch) instead of request-bound WebSockets.
neonConfig.fetchConnectionCache = false;
neonConfig.webSocketConstructor = globalThis.WebSocket;

export default httpModule;
