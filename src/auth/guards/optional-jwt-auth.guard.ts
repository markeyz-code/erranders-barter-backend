import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authentication that is allowed to be absent.
 *
 * A normal JWT guard rejects an anonymous request. That is wrong for a public page that
 * behaves differently when someone is signed in — for example a business's resource
 * library, which must render its header for a stranger but only list files for a student
 * who has been granted access.
 *
 * A missing or invalid token is treated as "anonymous"; a valid one populates `req.user`
 * exactly as usual. It never grants anything on its own — the service still decides what
 * an anonymous or identified caller may see.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(err: any, user: any): TUser {
    // Deliberately swallow auth errors: being signed out is a valid state here.
    return (user || null) as TUser;
  }
}
