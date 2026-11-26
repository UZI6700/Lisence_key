import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { NeonService } from '../neon/neon.service';

/**
 * Authenticates dashboard/admin requests via Neon Auth tokens (Managed
 * Better Auth on the Neon branch). The Bearer token is verified
 * cryptographically against the project JWKS.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly neon: NeonService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const auth = request.headers?.authorization as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required');
    }
    const token = auth.substring(7).trim();
    if (!token) throw new UnauthorizedException('Authentication required');

    const identity = await this.neon.verifyToken(token);
    const user = await this.neon.syncUser(identity);
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account is inactive');

    request.user = {
      id: user.id,
      externalId: identity.id,
      email: user.email,
      role: user.role,
      name: user.name,
      claims: identity,
    };
    return true;
  }
}
