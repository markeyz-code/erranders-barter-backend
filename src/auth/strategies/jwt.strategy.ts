import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'dev-secret-key',
    });
  }

  /**
   * Reads the live account on every authenticated request. This is what makes the admin
   * suspend/delete actions real: an already-issued token stops working as soon as the
   * account is suspended or removed (the JWT itself has no revocation list). It also lets
   * AdminGuard trust `isAdmin` without a second database lookup.
   */
  async validate(payload: any) {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid session');
    }

    let user: any;
    try {
      user = await this.usersService.findById(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid session');
    }

    if (!user) {
      throw new UnauthorizedException('This account no longer exists');
    }
    if (user.isActive === false) {
      throw new UnauthorizedException('This account is suspended. Contact support.');
    }

    return {
      userId: user._id.toString(),
      email: user.email || payload.email,
      isAdmin: user.isAdmin === true,
    };
  }
}
