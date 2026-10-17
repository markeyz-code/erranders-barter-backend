import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { Service } from '../services/schemas/service.schema';
import { ServicesService } from '../services/services.service';
import { ApplyProviderDto } from './dto/apply-provider.dto';
import { UpdateProviderProfileDto } from './dto/update-provider-profile.dto';

// Public provider card. Email, wallet, password reset fields and bank details never leave
// the API through this route.
const PUBLIC_PROVIDER_FIELDS =
  'firstName lastName avatar university hostel level rating isServiceProvider ' +
  'providerProfile createdAt';

const PROFILE_UPDATABLE_FIELDS = [
  'headline',
  'bio',
  'skills',
  'serviceArea',
  'isAcceptingBookings',
];

@Injectable()
export class ProvidersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Service.name) private serviceModel: Model<Service>,
    private readonly servicesService: ServicesService,
  ) {}

  /**
   * Applying is just a profile upgrade on the existing user — there is no separate provider
   * account and no role. Calling it again updates the public profile but leaves the counters
   * and the paused/accepting flag alone.
   */
  async apply(userId: string, dto: ApplyProviderDto): Promise<User> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const headline = typeof dto?.headline === 'string' ? dto.headline.trim() : '';
    if (!headline) throw new BadRequestException('headline is required');

    const existing = user.providerProfile;
    user.isServiceProvider = true;
    user.providerProfile = {
      headline,
      bio: this.cleanText(dto?.bio) ?? existing?.bio ?? '',
      skills: dto?.skills !== undefined ? this.cleanList(dto.skills) : existing?.skills || [],
      serviceArea: this.cleanText(dto?.serviceArea) ?? existing?.serviceArea ?? '',
      isAcceptingBookings: existing?.isAcceptingBookings ?? true,
      rating: existing?.rating ?? 0,
      totalReviews: existing?.totalReviews ?? 0,
      totalBookings: existing?.totalBookings ?? 0,
    };

    return user.save();
  }

  /** Public provider card: profile + their active services. */
  async getPublicProvider(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Provider not found');

    const provider = await this.userModel
      .findOne({ _id: id, isServiceProvider: true })
      .select(PUBLIC_PROVIDER_FIELDS)
      .exec();
    if (!provider) throw new NotFoundException('Provider not found');

    const services = await this.serviceModel
      .find({ providerId: provider._id, isActive: true })
      .populate('category', 'name icon')
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();

    return { provider, services };
  }

  /** Public, paginated active services for one provider. */
  async getPublicServices(id: string, query: any) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Provider not found');

    const exists = await this.userModel.exists({ _id: id, isServiceProvider: true });
    if (!exists) throw new NotFoundException('Provider not found');

    return this.servicesService.browse({ ...(query || {}), providerId: id });
  }

  async updateProfile(userId: string, dto: UpdateProviderProfileDto): Promise<User> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.isServiceProvider || !user.providerProfile) {
      throw new BadRequestException(
        'You are not a service provider yet. Apply first with POST /providers/apply.',
      );
    }

    let changed = false;
    if (dto?.headline !== undefined) {
      const headline = String(dto.headline).trim();
      if (!headline) throw new BadRequestException('headline cannot be empty');
      user.providerProfile.headline = headline;
      changed = true;
    }
    if (dto?.bio !== undefined) {
      user.providerProfile.bio = this.cleanText(dto.bio) ?? '';
      changed = true;
    }
    if (dto?.skills !== undefined) {
      user.providerProfile.skills = this.cleanList(dto.skills);
      changed = true;
    }
    if (dto?.serviceArea !== undefined) {
      user.providerProfile.serviceArea = this.cleanText(dto.serviceArea) ?? '';
      changed = true;
    }
    if (dto?.isAcceptingBookings !== undefined) {
      user.providerProfile.isAcceptingBookings = Boolean(dto.isAcceptingBookings);
      changed = true;
    }

    if (!changed) {
      throw new BadRequestException(
        `No updatable fields provided. Allowed: ${PROFILE_UPDATABLE_FIELDS.join(', ')}`,
      );
    }

    return user.save();
  }

  private cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return value.trim();
  }

  private cleanList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const clean = entry.trim();
      if (clean) seen.add(clean);
    }
    return [...seen].slice(0, 30);
  }
}
