import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PrismaService } from '../prisma/prisma.service';

// @neon/realtime/server uses conditional exports that TypeScript's legacy
// `node` resolution cannot follow; load the runtime entry via require.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRealtime, rawSql } = require('@neon/realtime/server');

const APP_ROLES = new Set(['ADMIN', 'USER', 'VIEWER']);

export interface NeonIdentity {
  id: string;
  email?: string;
  name?: string;
  role: string;
  token: string;
}

export interface NeonConfigSummary {
  configured: boolean;
  branch: string | null;
  branchId: string | null;
  database: boolean;
  auth: boolean;
  functions: boolean;
  aiGateway: boolean;
  realtime: boolean;
}

/**
 * Server-side integration for the Neon services declared in neon.ts:
 * Lakebase Postgres, Neon Auth, Functions, AI Gateway and Realtime.
 */
@Injectable()
export class NeonService {
  private readonly logger = new Logger(NeonService.name);

  constructor(private readonly prisma: PrismaService) {}

  config(): NeonConfigSummary {
    return {
      configured: Boolean(process.env.NEON_BRANCH_ID),
      branch: process.env.NEON_BRANCH || null,
      branchId: process.env.NEON_BRANCH_ID || null,
      database: Boolean(process.env.DATABASE_URL),
      auth: Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_JWKS_URL),
      functions: Boolean(process.env.NEON_FUNCTION_HOST_SUFFIX),
      aiGateway: Boolean(process.env.NEON_AI_GATEWAY_BASE_URL && process.env.NEON_AI_GATEWAY_TOKEN),
      realtime: Boolean(process.env.NEON_REALTIME_URL && process.env.NEON_REALTIME_SECRET),
    };
  }

  // ----------------------------------------------------------------
  // Neon Auth (Managed Better Auth)
  // ----------------------------------------------------------------

  /** Sign in through the branch's Managed Better Auth server and return a JWT. */
  async signIn(email: string, password: string, origin = 'http://localhost:3000'): Promise<NeonIdentity> {
    const base = this.requireEnv('NEON_AUTH_BASE_URL');
    const headers = { 'Content-Type': 'application/json', Origin: origin };

    const signInRes = await fetch(`${base}/sign-in/email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });
    const signInBody: any = await signInRes.json().catch(() => ({}));
    if (!signInRes.ok) {
      throw new UnauthorizedException(signInBody?.message || 'Neon Auth sign-in failed');
    }
    const cookie = signInRes.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new UnauthorizedException('Neon Auth did not return a session cookie');

    const tokenRes = await fetch(`${base}/token`, { method: 'GET', headers: { Cookie: cookie, Origin: origin } });
    const tokenBody: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody?.token) {
      throw new UnauthorizedException(tokenBody?.message || 'Neon Auth did not return a JWT');
    }
    const identity = await this.verifyToken(tokenBody.token);
    return { ...identity, token: tokenBody.token };
  }

  /** Verify a Neon Auth JWT against the branch JWKS, pinned to this project. */
  async verifyToken(token: string): Promise<Omit<NeonIdentity, 'token'>> {
    const jwksUrl = this.requireEnv('NEON_AUTH_JWKS_URL');
    const issuer = new URL(this.requireEnv('NEON_AUTH_BASE_URL')).origin;
    const jwks = createRemoteJWKSet(new URL(jwksUrl));
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });
      if (!payload.sub) throw new Error('missing sub');
      const claims = payload as Record<string, unknown>;
      const adminEmails = (process.env.SUPABASE_ADMIN_EMAILS || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      const email = String(claims.email || '').toLowerCase();
      const role = claims.role === 'admin' || adminEmails.includes(email) ? 'ADMIN' : 'USER';
      return {
        id: String(payload.sub),
        email,
        name: String(claims.name || ''),
        role,
      };
    } catch (e: any) {
      this.logger.debug(`Neon token verification failed: ${e?.message || 'unknown'}`);
      throw new UnauthorizedException('Invalid or expired Neon access token');
    }
  }

  /** Mirror a Neon Auth identity into the local users table (same FK targets). */
  async syncUser(identity: Omit<NeonIdentity, 'token'>) {
    const email = String(identity.email || '').toLowerCase().trim();
    if (!email) throw new UnauthorizedException('Neon identity is missing an email');
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ supabaseId: identity.id }, { email }] },
    });
    const role = APP_ROLES.has(identity.role.toUpperCase()) ? identity.role.toUpperCase() : 'USER';
    const data = {
      supabaseId: identity.id,
      email,
      name: identity.name || email.split('@')[0],
      role: existing?.role === 'ADMIN' ? 'ADMIN' : role,
      status: 'ACTIVE',
      emailVerified: new Date(),
    };
    if (existing) return this.prisma.user.update({ where: { id: existing.id }, data });
    return this.prisma.user.create({
      data: { ...data, password: `!neon:${randomUUID()}` },
    });
  }

  // ----------------------------------------------------------------
  // Neon Functions
  // ----------------------------------------------------------------

  functionUrl(slug: string): string {
    const branchId = this.requireEnv('NEON_BRANCH_ID');
    const suffix = this.requireEnv('NEON_FUNCTION_HOST_SUFFIX');
    return `https://${branchId}-${slug}${suffix}`;
  }

  async invokeFunction(slug: string, path = ''): Promise<{ status: number; body: string }> {
    const url = `${this.functionUrl(slug)}${path}`;
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
  }

  // ----------------------------------------------------------------
  // Neon AI Gateway
  // ----------------------------------------------------------------

  async models(): Promise<{ total: number; enabled: number; sample: string[] }> {
    const base = this.requireEnv('NEON_AI_GATEWAY_BASE_URL');
    const token = this.requireEnv('NEON_AI_GATEWAY_TOKEN');
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || `AI Gateway returned ${res.status}`);
    const data = Array.isArray(body?.data) ? body.data : [];
    return {
      total: data.length,
      enabled: data.filter((model: any) => model.enabled).length,
      sample: data.slice(0, 5).map((model: any) => model.id),
    };
  }

  async chat(model: string, prompt: string): Promise<{ status: number; body: any }> {
    const base = this.requireEnv('NEON_AI_GATEWAY_BASE_URL');
    const token = this.requireEnv('NEON_AI_GATEWAY_TOKEN');
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  // ----------------------------------------------------------------
  // Neon Realtime
  // ----------------------------------------------------------------

  /** Seal a read-only live query. The secret never leaves the server. */
  async sealRealtimeQuery(sql: string, parameters: unknown[] = []) {
    const secret = this.requireEnv('NEON_REALTIME_SECRET');
    const db = new URL(this.requireEnv('DATABASE_URL')).pathname.replace(/^\//, '') || 'neondb';
    const realtime = createRealtime({ secret, db });
    return realtime.seal({ query: rawSql(sql, parameters as any) });
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
  }
}
