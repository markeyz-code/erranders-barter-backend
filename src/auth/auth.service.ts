import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { EmailService } from '../notifications/email.service';

const PASSWORD_RESET_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async signup(dto: { firstName: string; lastName: string; email: string; password: string; whatsappNumber: string; university: string; hostel: string; level: string }) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const hashed = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.create({ ...dto, password: hashed });
    return this.generateToken(user);
  }

  async login(dto: { email: string; password: string }) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials');

    // Suspension is enforced at sign-in as well as in JwtStrategy, so a suspended user
    // cannot simply log in again to get a fresh token.
    if (user.isActive === false) {
      throw new UnauthorizedException('This account is suspended. Contact support.');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.generateToken(user);
  }

  async firebaseLogin(idToken: string) {
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }

    try {
      const decodedToken = await getAuth().verifyIdToken(idToken);
      const email = decodedToken.email;
      if (!email) throw new UnauthorizedException('No email found in token');

      const names = (decodedToken.name || '').split(' ');
      const profile = {
        id: decodedToken.uid,
        emails: [{ value: email }],
        name: {
          givenName: names[0] || 'User',
          familyName: names.slice(1).join(' ') || ''
        },
        photos: [{ value: decodedToken.picture || '' }]
      };
      const user = await this.usersService.findOrCreateGoogle(profile);
      return this.generateToken(user);
    } catch (e) {
      throw new UnauthorizedException('Invalid Firebase Token');
    }
  }

  /**
   * Issues a real, single-use, expiring reset token. The response is deliberately the same
   * whether or not the email exists, so the route cannot be used to enumerate accounts.
   */
  async forgotPassword(email: string) {
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail) throw new BadRequestException('email is required');

    const user = await this.usersService.findByEmail(cleanEmail);
    if (!user) return { message: PASSWORD_RESET_MESSAGE };

    const frontendUrl = (process.env.FRONTEND_URL || '').trim();
    if (!frontendUrl) {
      throw new ServiceUnavailableException(
        'Password reset is not configured: FRONTEND_URL is not set.',
      );
    }

    const token = await this.usersService.createPasswordResetToken(user._id.toString());
    const resetUrl = `${frontendUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

    await this.sendPasswordResetEmail(user.email, resetUrl);

    return { message: PASSWORD_RESET_MESSAGE };
  }

  async resetPassword(dto: { token: string; password: string }) {
    const token = typeof dto?.token === 'string' ? dto.token.trim() : '';
    const password = typeof dto?.password === 'string' ? dto.password : '';

    if (!token) throw new BadRequestException('A reset token is required');
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    const reset = await this.usersService.resetPasswordWithToken(token, password);
    if (!reset) {
      throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
    }

    return { message: 'Password has been reset successfully.' };
  }

  /**
   * Sends the reset link through the configured transactional email service (Resend).
   */
  private async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    try {
      const sent = await this.emailService.sendPasswordResetEmail(to, resetUrl);
      if (!sent) {
        throw new ServiceUnavailableException(
          'The password reset email could not be sent. Please try again later.',
        );
      }
    } catch (err: any) {
      this.logger.error(`Failed to send password reset email: ${err?.message || err}`);
      throw new ServiceUnavailableException(
        'The password reset email could not be sent. Please try again later.',
      );
    }
  }

  /**
   * Public wrapper used when a signup is completed outside this service (business
   * onboarding creates the account and the business together).
   */
  issueTokenFor(user: any) {
    return this.generateToken(user);
  }

  private generateToken(user: any) {
    const payload = { sub: user._id, email: user.email };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id,
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        avatar: user.avatar,
        isVerified: user.isVerified,
        isAdmin: user.isAdmin === true,
        isActive: user.isActive !== false,
      },
    };
  }
}
