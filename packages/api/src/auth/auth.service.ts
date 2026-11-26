import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { NeonService } from '../neon/neon.service';

const APP_ROLES = new Set(['ADMIN', 'USER', 'VIEWER']);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly neon: NeonService,
  ) {}

  /** Login against local accounts (legacy JWT/Prisma path). */
  async login(email: string, password: string) {
    return this.legacyLogin(email, password);
  }

  /** Login through Neon Auth (Managed Better Auth) on the current branch. */
  async neonLogin(email: string, password: string) {
    const identity = await this.neon.signIn(email, password);
    const user = await this.neon.syncUser(identity);
    return {
      accessToken: identity.token,
      refreshToken: identity.token,
      user: this.safeUser(user),
      provider: 'neon',
    };
  }

  async register(
    data: { email: string; password: string; name?: string; role?: string },
    requester?: { role?: string },
  ) {
    if (String(requester?.role || '').toUpperCase() !== 'ADMIN') {
      throw new ForbiddenException('Only administrators can create users');
    }
    if (!data.email || !data.password) {
      throw new BadRequestException('Email and password are required');
    }
    if (data.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const email = data.email.toLowerCase().trim();
    const role = APP_ROLES.has(String(data.role || '').toUpperCase())
      ? String(data.role).toUpperCase()
      : 'USER';

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');
    const user = await this.prisma.user.create({
      data: {
        email,
        password: await this.passwordService.hashPassword(data.password),
        name: data.name || email.split('@')[0],
        role,
        status: 'ACTIVE',
      },
    });
    return { ...this.legacyTokens(user), user: this.safeUser(user), provider: 'local' };
  }

  async refreshToken(refreshToken: string) {
    return this.legacyRefreshToken(refreshToken);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await this.passwordService.verifyPassword(user.password, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await this.passwordService.hashPassword(newPassword) },
    });
    return { changed: true, provider: 'local' };
  }

  // ------------------------------------------------------------------
  // Shared / legacy helpers
  // ------------------------------------------------------------------

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  private safeUser(user: { id: string; name: string | null; email: string; role: string }) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  private legacyTokens(user: { id: string; email: string; role: string }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: '15m' }),
      refreshToken: this.jwtService.sign(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'license-management-refresh-secret',
        expiresIn: '30d',
      }),
    };
  }

  private async legacyLogin(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: String(email || '').toLowerCase().trim() },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Invalid credentials');
    const ok = await this.passwordService.verifyPassword(user.password, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return { ...this.legacyTokens(user), user: this.safeUser(user), provider: 'local' };
  }

  private async legacyRefreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'license-management-refresh-secret',
      });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== 'ACTIVE') throw new Error('inactive');
      return { ...this.legacyTokens(user), user: this.safeUser(user), provider: 'local' };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
