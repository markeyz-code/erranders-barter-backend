import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Service, PriceType } from './schemas/service.schema';
import { User } from '../users/schemas/user.schema';
import { Category, CategoryDocument } from '../categories/category.schema';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { AvailabilityService } from '../availability/availability.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { wallClockNow, timeToMinutes } from '../availability/slot-math';

// Fields the owner may edit. providerId, rating and totalBookings are platform-controlled.
const SERVICE_UPDATABLE_FIELDS = [
  'title',
  'description',
  'category',
  'priceType',
  'price',
  'durationMinutes',
  'bufferMinutes',
  'images',
  'location',
  'isRemote',
  'tags',
  'isActive',
];

const PROVIDER_POPULATE =
  'firstName lastName avatar university hostel level rating isServiceProvider providerProfile';

@Injectable()
export class ServicesService {
  constructor(
    @InjectModel(Service.name) private serviceModel: Model<Service>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    private readonly availabilityService: AvailabilityService,
  ) {}

  /** Public browse. Only active services; inactive ones stay visible to their owner/admin. */
  async browse(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));

    const filter: any = { isActive: true };

    if (query?.providerId) {
      if (!Types.ObjectId.isValid(query.providerId)) {
        throw new BadRequestException('Invalid providerId');
      }
      filter.providerId = query.providerId;
    }

    if (query?.category) {
      const category = await this.resolveCategory(query.category);
      if (!category) {
        // An unknown category is an empty result, not a 500 or a silently unfiltered list.
        return { data: [], meta: { total: 0, page, limit, totalPages: 1 } };
      }
      filter.category = category;
    }

    if (query?.search) {
      const search = this.escapeRegex(String(query.search).trim());
      if (search) {
        filter.$or = [
          { title: new RegExp(search, 'i') },
          { description: new RegExp(search, 'i') },
          { tags: new RegExp(search, 'i') },
        ];
      }
    }

    if (query?.isRemote !== undefined) {
      filter.isRemote = this.parseBoolean(query.isRemote, 'isRemote');
    }

    const minPrice = this.parseOptionalNumber(query?.minPrice, 'minPrice');
    const maxPrice = this.parseOptionalNumber(query?.maxPrice, 'maxPrice');
    if (minPrice !== null || maxPrice !== null) {
      filter.price = {};
      if (minPrice !== null) filter.price.$gte = minPrice;
      if (maxPrice !== null) filter.price.$lte = maxPrice;
      if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
        throw new BadRequestException('minPrice cannot be greater than maxPrice');
      }
    }

    const [data, total] = await Promise.all([
      this.serviceModel
        .find(filter)
        .populate('providerId', PROVIDER_POPULATE)
        .populate('category', 'name icon')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.serviceModel.countDocuments(filter),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async findOne(id: string): Promise<Service> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Service not found');

    const service = await this.serviceModel
      .findById(id)
      .populate('providerId', PROVIDER_POPULATE)
      .populate('category', 'name icon')
      .exec();
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  /** Provider-only creation. A normal user must apply first via POST /providers/apply. */
  async create(dto: CreateServiceDto, userId: string): Promise<Service> {
    await this.assertProvider(userId);

    const category = await this.requireCategory(dto.category);
    const priceType = dto.priceType || PriceType.FIXED;
    const title = dto.title.trim();
    const description = dto.description.trim();
    if (!title) throw new BadRequestException('title cannot be empty');
    if (!description) throw new BadRequestException('description cannot be empty');

    const service = new this.serviceModel({
      providerId: userId,
      title,
      description,
      category: category._id,
      priceType,
      price: this.normalisePrice(priceType, dto.price),
      durationMinutes: dto.durationMinutes,
      bufferMinutes: dto.bufferMinutes ?? 0,
      images: this.cleanList(dto.images),
      location: typeof dto.location === 'string' ? dto.location.trim() : '',
      isRemote: dto.isRemote ?? false,
      tags: this.cleanList(dto.tags),
      isActive: dto.isActive ?? true,
      rating: 0,
      totalBookings: 0,
    });

    return service.save();
  }

  /** Owner-only edit. 404 for an unknown id, 403 when it belongs to someone else. */
  async update(id: string, userId: string, dto: UpdateServiceDto): Promise<Service> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Service not found');

    const service = await this.serviceModel.findById(id).exec();
    if (!service) throw new NotFoundException('Service not found');
    this.assertOwner(service, userId);

    const safeUpdate: any = {};
    for (const field of SERVICE_UPDATABLE_FIELDS) {
      if (dto && (dto as any)[field] !== undefined) safeUpdate[field] = (dto as any)[field];
    }
    if (Object.keys(safeUpdate).length === 0) {
      throw new BadRequestException(
        `No updatable fields provided. Allowed: ${SERVICE_UPDATABLE_FIELDS.join(', ')}`,
      );
    }

    if (safeUpdate.title !== undefined) {
      const title = String(safeUpdate.title).trim();
      if (!title) throw new BadRequestException('title cannot be empty');
      safeUpdate.title = title;
    }
    if (safeUpdate.description !== undefined) {
      const description = String(safeUpdate.description).trim();
      if (!description) throw new BadRequestException('description cannot be empty');
      safeUpdate.description = description;
    }
    if (safeUpdate.category !== undefined) {
      const category = await this.requireCategory(safeUpdate.category);
      safeUpdate.category = category._id;
    }
    if (safeUpdate.priceType !== undefined && !Object.values(PriceType).includes(safeUpdate.priceType)) {
      throw new BadRequestException(`Invalid priceType. Allowed: ${Object.values(PriceType).join(', ')}`);
    }
    if (safeUpdate.durationMinutes !== undefined) {
      const duration = Number(safeUpdate.durationMinutes);
      if (!Number.isInteger(duration) || duration < 1) {
        throw new BadRequestException('durationMinutes must be a whole number of at least 1');
      }
      safeUpdate.durationMinutes = duration;
    }
    if (safeUpdate.bufferMinutes !== undefined) {
      const buffer = Number(safeUpdate.bufferMinutes);
      if (!Number.isInteger(buffer) || buffer < 0) {
        throw new BadRequestException('bufferMinutes must be a whole number of at least 0');
      }
      safeUpdate.bufferMinutes = buffer;
    }
    if (safeUpdate.images !== undefined) safeUpdate.images = this.cleanList(safeUpdate.images);
    if (safeUpdate.tags !== undefined) safeUpdate.tags = this.cleanList(safeUpdate.tags);
    if (safeUpdate.location !== undefined) safeUpdate.location = String(safeUpdate.location).trim();

    // Price rules are checked against the *resulting* pair, so a PATCH that only flips
    // priceType from fixed to negotiable still gets a coherent price.
    const finalPriceType = safeUpdate.priceType ?? service.priceType;
    if (safeUpdate.priceType !== undefined || safeUpdate.price !== undefined) {
      safeUpdate.price = this.normalisePrice(finalPriceType, safeUpdate.price ?? service.price);
    }

    return this.serviceModel.findByIdAndUpdate(id, safeUpdate, { new: true }).exec();
  }

  /**
   * Owner-only delete. Refuses while a confirmed booking is still upcoming; pending requests
   * are declined first so no customer is left holding a booking for a listing that is gone.
   */
  async remove(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Service not found');

    const service = await this.serviceModel.findById(id).exec();
    if (!service) throw new NotFoundException('Service not found');
    this.assertOwner(service, userId);

    const { date: today, minutes: nowMinutes } = wallClockNow();
    const confirmed = await this.bookingModel
      .find({ serviceId: id, status: BookingStatus.CONFIRMED, date: { $gte: today } })
      .select('date startTime')
      .lean()
      .exec();

    const hasUpcoming = confirmed.some(
      (booking) => booking.date > today || timeToMinutes(booking.startTime) > nowMinutes,
    );
    if (hasUpcoming) {
      throw new BadRequestException(
        'This service has an upcoming confirmed booking and cannot be deleted. Cancel or complete the booking first.',
      );
    }

    const declined = await this.bookingModel
      .updateMany(
        { serviceId: id, status: BookingStatus.PENDING },
        {
          $set: {
            status: BookingStatus.DECLINED,
            blocksSlot: false,
            cancelledBy: userId,
            cancellationReason: 'Service was removed by the provider',
          },
          $unset: { slotKeys: 1 },
        },
      )
      .exec();

    await this.serviceModel.findByIdAndDelete(id).exec();

    return {
      success: true,
      deleted: true,
      serviceId: id,
      declinedBookings: declined.modifiedCount || 0,
    };
  }

  /** The owner's full inventory, active and paused, newest first. */
  async findMyListings(userId: string): Promise<Service[]> {
    return this.serviceModel
      .find({ providerId: userId })
      .populate('category', 'name icon')
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Computed slots for one date, used by GET /services/:id/availability. */
  async getAvailability(id: string, date: string) {
    return this.availabilityService.computeSlots(id, date);
  }

  private async assertProvider(userId: string): Promise<void> {
    const provider = await this.userModel
      .findById(userId)
      .select('isServiceProvider')
      .lean()
      .exec();
    if (!provider) throw new NotFoundException('User not found');
    if (!provider.isServiceProvider) {
      throw new ForbiddenException(
        'Only service providers can create listings. Apply first with POST /providers/apply.',
      );
    }
  }

  private assertOwner(service: Service, userId: string): void {
    if (service.providerId?.toString() !== userId) {
      throw new ForbiddenException('You can only manage your own services');
    }
  }

  private async requireCategory(value: string): Promise<CategoryDocument> {
    if (!value || !Types.ObjectId.isValid(value)) {
      throw new BadRequestException('category must be an existing category id');
    }
    const category = await this.categoryModel.findById(value).exec();
    if (!category) throw new BadRequestException('category must be an existing category id');
    return category;
  }

  /**
   * The browse filter accepts either a category id or its name, because the website links by
   * name ("Services") and the admin app links by id.
   */
  private async resolveCategory(value: string): Promise<Types.ObjectId | null> {
    if (Types.ObjectId.isValid(value)) {
      const exists = await this.categoryModel.exists({ _id: value });
      return exists ? new Types.ObjectId(value) : null;
    }

    const name = new RegExp(`^${this.escapeRegex(String(value).trim())}$`, 'i');
    const category = await this.categoryModel.findOne({ name }).select('_id').lean().exec();
    return category ? (category._id as Types.ObjectId) : null;
  }

  private normalisePrice(priceType: PriceType, price: unknown): number {
    // Negotiable listings never carry a price: there is nothing to snapshot onto a booking.
    if (priceType === PriceType.NEGOTIABLE) return 0;

    if (price === undefined || price === null || price === '') {
      throw new BadRequestException(`price is required for a ${priceType} service`);
    }
    const numeric = Number(price);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new BadRequestException('price must be a number of at least 0');
    }
    return numeric;
  }

  private parseBoolean(value: unknown, field: string): boolean {
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    throw new BadRequestException(`${field} must be true or false`);
  }

  private parseOptionalNumber(value: unknown, field: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new BadRequestException(`${field} must be a number of at least 0`);
    }
    return numeric;
  }

  private cleanList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const clean = entry.trim();
      if (clean) seen.add(clean);
    }
    return [...seen];
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
