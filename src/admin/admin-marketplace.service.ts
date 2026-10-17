import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Service } from '../services/schemas/service.schema';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { User } from '../users/schemas/user.schema';
import { isValidDateString } from '../availability/slot-math';
import { ModerateServiceDto } from './dto/moderate-service.dto';

const PROVIDER_POPULATE =
  'firstName lastName avatar university hostel level rating isServiceProvider providerProfile';
const CUSTOMER_POPULATE = 'firstName lastName avatar university hostel level rating';

@Injectable()
export class AdminMarketplaceService {
  constructor(
    @InjectModel(Service.name) private serviceModel: Model<Service>,
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  /** Every service, active or not, with the full moderation filter set. */
  async listServices(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const filter: any = {};

    if (query?.isActive !== undefined) {
      filter.isActive = this.parseBoolean(query.isActive, 'isActive');
    }
    if (query?.providerId) {
      if (!Types.ObjectId.isValid(query.providerId)) {
        throw new BadRequestException('Invalid providerId');
      }
      filter.providerId = query.providerId;
    }
    if (query?.category) {
      if (!Types.ObjectId.isValid(query.category)) {
        throw new BadRequestException('Invalid category');
      }
      filter.category = query.category;
    }
    if (query?.search) {
      const search = new RegExp(this.escapeRegex(String(query.search).trim()), 'i');
      filter.$or = [{ title: search }, { description: search }, { tags: search }];
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

  /** Deactivate (or reactivate) a service without deleting its history. */
  async moderateService(id: string, dto: ModerateServiceDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Service not found');

    if (typeof dto?.isActive !== 'boolean') {
      throw new BadRequestException('isActive is required and must be true or false');
    }

    const service = await this.serviceModel
      .findByIdAndUpdate(id, { isActive: dto.isActive }, { new: true })
      .populate('providerId', PROVIDER_POPULATE)
      .populate('category', 'name icon')
      .exec();
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  /** All bookings, filterable by status, date and participant. */
  async listBookings(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const filter: any = {};

    if (query?.status) {
      if (!Object.values(BookingStatus).includes(query.status)) {
        throw new BadRequestException(
          `Invalid status. Allowed: ${Object.values(BookingStatus).join(', ')}`,
        );
      }
      filter.status = query.status;
    }
    if (query?.date) {
      if (!isValidDateString(query.date)) {
        throw new BadRequestException('date must be a real calendar date (YYYY-MM-DD)');
      }
      filter.date = query.date;
    }
    for (const field of ['providerId', 'customerId', 'serviceId'] as const) {
      if (query?.[field]) {
        if (!Types.ObjectId.isValid(query[field])) throw new BadRequestException(`Invalid ${field}`);
        filter[field] = query[field];
      }
    }

    const [data, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        .populate('serviceId', 'title images price priceType durationMinutes isRemote isActive')
        .populate('providerId', PROVIDER_POPULATE)
        .populate('customerId', CUSTOMER_POPULATE)
        .sort({ date: -1, startTime: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.bookingModel.countDocuments(filter),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  /** Every provider with service and booking counts, so the admin app can manage them. */
  async listProviders(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));

    const filter: any = { isServiceProvider: true };
    if (query?.search) {
      const search = new RegExp(this.escapeRegex(String(query.search).trim()), 'i');
      filter.$or = [{ firstName: search }, { lastName: search }, { email: search }];
    }

    const [providers, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select(PROVIDER_POPULATE + ' email isVerified createdAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.userModel.countDocuments(filter),
    ]);

    const providerIds = providers.map((provider: any) => provider._id);
    const [serviceCounts, bookingCounts] = await Promise.all([
      this.serviceModel
        .aggregate([
          { $match: { providerId: { $in: providerIds } } },
          {
            $group: {
              _id: '$providerId',
              total: { $sum: 1 },
              active: { $sum: { $cond: ['$isActive', 1, 0] } },
            },
          },
        ])
        .exec(),
      this.bookingModel
        .aggregate([
          { $match: { providerId: { $in: providerIds } } },
          {
            $group: {
              _id: '$providerId',
              total: { $sum: 1 },
              completed: {
                $sum: { $cond: [{ $eq: ['$status', BookingStatus.COMPLETED] }, 1, 0] },
              },
              upcoming: {
                $sum: {
                  $cond: [
                    { $in: ['$status', [BookingStatus.PENDING, BookingStatus.CONFIRMED]] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ])
        .exec(),
    ]);

    const serviceMap = new Map(serviceCounts.map((row: any) => [row._id.toString(), row]));
    const bookingMap = new Map(bookingCounts.map((row: any) => [row._id.toString(), row]));

    const data = providers.map((provider: any) => {
      const service = serviceMap.get(provider._id.toString()) || {};
      const booking = bookingMap.get(provider._id.toString()) || {};
      return {
        ...provider,
        counts: {
          services: service.total || 0,
          activeServices: service.active || 0,
          bookings: booking.total || 0,
          completedBookings: booking.completed || 0,
          upcomingBookings: booking.upcoming || 0,
        },
      };
    });

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  private parseBoolean(value: unknown, field: string): boolean {
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    throw new BadRequestException(`${field} must be true or false`);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
