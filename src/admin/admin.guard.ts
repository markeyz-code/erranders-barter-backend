import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Small admin guard for the /admin/* surface.
 *
 * It is deliberately not a role system: it trusts the authenticated principal produced by
 * JwtStrategy (which reads the live user document on every request, so a suspended or
 * deleted account cannot keep using an old token) and accepts either:
 *
 *   - `isAdmin === true` on the User document, or
 *   - the caller's email appearing in the comma-separated ADMIN_EMAILS environment
 *     variable. This is the bootstrap path for a deployment whose admin row predates the
 *     flag, so an owner can grant access without editing the database by hand.
 *
 * It never falls back to "any valid JWT" — that was the hole this replaces.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const principal = request?.user;

    if (!principal?.userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const email = String(principal.email || '').trim().toLowerCase();
    const allowlist = (
      this.configService.get<string>('ADMIN_EMAILS') ||
      process.env.ADMIN_EMAILS ||
      ''
    )
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    const isAdmin = principal.isAdmin === true || (email && allowlist.includes(email));

    if (!isAdmin) {
      throw new ForbiddenException(
        'Admin access required. Ask the owner to set isAdmin on this account or add its email to ADMIN_EMAILS on the backend.',
      );
    }

    return true;
  }
}
