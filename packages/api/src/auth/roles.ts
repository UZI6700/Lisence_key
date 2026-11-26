import { ForbiddenException } from '@nestjs/common';

/** Throw 403 unless the authenticated user has one of the required roles. */
export function assertRole(request: any, ...roles: string[]): void {
  const role = String(request?.user?.role || '').toUpperCase();
  if (!roles.map((value) => value.toUpperCase()).includes(role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}
