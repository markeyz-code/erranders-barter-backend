import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ProviderAvailability,
} from './schemas/provider-availability.schema';
import { AvailabilityException } from './schemas/availability-exception.schema';
import { Service } from '../services/schemas/service.schema';
import { Booking } from '../bookings/schemas/booking.schema';
import {
  AvailabilityExceptionInput,
  AvailabilitySlot,
  buildDaySlots,
  dayOfWeekForDate,
  isValidDateString,
  isValidTimeString,
  timeToMinutes,
} from './slot-math';

export interface ComputeSlotsOptions {
  /** A booking being rescheduled must not block its own new time. */
  excludeBookingId?: string;
  now?: Date;
}

interface NormalisedWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectModel(ProviderAvailability.name)
    private availabilityModel: Model<ProviderAvailability>,
    @InjectModel(AvailabilityException.name)
    private exceptionModel: Model<AvailabilityException>,
    @InjectModel(Service.name) private serviceModel: Model<Service>,
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
  ) {}

  /** The caller's weekly windows plus every date override they have recorded. */
  async getMine(providerId: string) {
    const [weeklyWindows, exceptions] = await Promise.all([
      this.availabilityModel
        .find({ providerId })
        .sort({ dayOfWeek: 1, startTime: 1 })
        .exec(),
      this.exceptionModel.find({ providerId }).sort({ date: 1, startTime: 1 }).exec(),
    ]);

    return { weeklyWindows, exceptions };
  }

  /**
   * Replaces the whole weekly schedule in one shot. Everything is validated (including
   * overlapping windows on the same day) before the old rows are removed, so a bad payload
   * cannot leave the provider with a half-deleted schedule.
   */
  async replaceWeekly(providerId: string, body: unknown): Promise<ProviderAvailability[]> {
    // The contract sends the array directly; also accept `{ windows: [...] }` for clients
    // that prefer a wrapped body.
    const raw = Array.isArray(body)
      ? body
      : Array.isArray((body as any)?.windows)
        ? (body as any).windows
        : null;

    if (!raw) {
      throw new BadRequestException(
        'Body must be an array of weekly windows, or an object with a "windows" array',
      );
    }

    const windows = raw.map((window: any, index: number) => this.normaliseWindow(window, index));
    this.assertNoOverlaps(windows);

    await this.availabilityModel.deleteMany({ providerId }).exec();

    if (windows.length) {
      await this.availabilityModel.insertMany(
        windows.map((window) => ({ ...window, providerId: new Types.ObjectId(providerId) })),
      );
    }

    return this.availabilityModel
      .find({ providerId })
      .sort({ dayOfWeek: 1, startTime: 1 })
      .exec();
  }

  async addException(
    providerId: string,
    input: {
      date?: string;
      isBlocked?: boolean;
      startTime?: string;
      endTime?: string;
      note?: string;
    },
  ): Promise<AvailabilityException> {
    const date = typeof input?.date === 'string' ? input.date.trim() : '';
    if (!isValidDateString(date)) {
      throw new BadRequestException('date must be a real calendar date in YYYY-MM-DD format');
    }
    if (typeof input?.isBlocked !== 'boolean') {
      throw new BadRequestException('isBlocked is required and must be true or false');
    }

    const startTime = this.cleanTime(input?.startTime, 'startTime');
    const endTime = this.cleanTime(input?.endTime, 'endTime');

    // A partial block/open needs both ends; a whole-day block needs neither.
    if ((startTime && !endTime) || (!startTime && endTime)) {
      throw new BadRequestException('startTime and endTime must be provided together');
    }
    if (startTime && endTime && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new BadRequestException('endTime must be later than startTime');
    }

    // POSTing the same override twice updates its note instead of creating a duplicate.
    return this.exceptionModel
      .findOneAndUpdate(
        {
          providerId,
          date,
          isBlocked: input.isBlocked,
          startTime: startTime || null,
          endTime: endTime || null,
        },
        { $set: { note: typeof input?.note === 'string' ? input.note.trim() : '' } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async removeException(providerId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Availability exception not found');

    const exception = await this.exceptionModel.findById(id).exec();
    if (!exception) throw new NotFoundException('Availability exception not found');
    if (exception.providerId?.toString() !== providerId) {
      throw new ForbiddenException('You can only delete your own availability exceptions');
    }

    await this.exceptionModel.findByIdAndDelete(id).exec();
    return { success: true, deleted: true, exceptionId: id };
  }

  /**
   * Computed slots for `GET /services/:id/availability`. All the arithmetic lives in
   * `buildDaySlots`; this method only loads the inputs and enforces the contract.
   */
  async computeSlots(
    serviceId: string,
    date: string,
    options: ComputeSlotsOptions = {},
  ): Promise<AvailabilitySlot[]> {
    if (!isValidDateString(date)) {
      throw new BadRequestException('date is required and must be a real calendar date (YYYY-MM-DD)');
    }
    if (!Types.ObjectId.isValid(serviceId)) throw new NotFoundException('Service not found');

    const service = await this.serviceModel
      .findById(serviceId)
      .select('providerId durationMinutes bufferMinutes')
      .exec();
    if (!service) throw new NotFoundException('Service not found');

    return this.computeSlotsForService(service, date, options);
  }

  /** Same computation for callers that already loaded the service document. */
  async computeSlotsForService(
    service: Service,
    date: string,
    options: ComputeSlotsOptions = {},
  ): Promise<AvailabilitySlot[]> {
    if (!isValidDateString(date)) {
      throw new BadRequestException('date is required and must be a real calendar date (YYYY-MM-DD)');
    }

    const providerId = service.providerId?.toString?.() || String(service.providerId);
    const bookingFilter: any = { providerId, date, blocksSlot: true };
    if (options.excludeBookingId) {
      if (!Types.ObjectId.isValid(options.excludeBookingId)) {
        throw new BadRequestException('excludeBookingId is not a valid id');
      }
      bookingFilter._id = { $ne: options.excludeBookingId };
    }

    const [windows, exceptions, bookings] = await Promise.all([
      this.availabilityModel
        .find({ providerId, dayOfWeek: dayOfWeekForDate(date), isActive: true })
        .lean()
        .exec(),
      this.exceptionModel.find({ providerId, date }).lean().exec(),
      this.bookingModel
        .find(bookingFilter)
        .select('startTime endTime durationMinutes bufferMinutes')
        .lean()
        .exec(),
    ]);

    return buildDaySlots({
      date,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes,
      windows: windows as any,
      exceptions: exceptions as unknown as AvailabilityExceptionInput[],
      bookings: bookings as any,
      now: options.now,
    });
  }

  private normaliseWindow(input: any, index: number): NormalisedWindow {
    const dayOfWeek = Number(input?.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new BadRequestException(
        `windows[${index}].dayOfWeek must be an integer from 0 (Sunday) to 6 (Saturday)`,
      );
    }

    const startTime = this.cleanTime(input?.startTime, `windows[${index}].startTime`);
    const endTime = this.cleanTime(input?.endTime, `windows[${index}].endTime`);
    if (!startTime) throw new BadRequestException(`windows[${index}].startTime is required`);
    if (!endTime) throw new BadRequestException(`windows[${index}].endTime is required`);
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new BadRequestException(`windows[${index}].endTime must be later than startTime`);
    }

    return {
      dayOfWeek,
      startTime,
      endTime,
      isActive: input?.isActive === undefined ? true : Boolean(input.isActive),
    };
  }

  private cleanTime(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (!isValidTimeString(value)) {
      throw new BadRequestException(`${field} must be a 24-hour time like "09:00"`);
    }
    return value;
  }

  /** Overlapping windows would duplicate slots, so reject them up front. */
  private assertNoOverlaps(windows: NormalisedWindow[]): void {
    const byDay = new Map<number, NormalisedWindow[]>();
    for (const window of windows) {
      byDay.set(window.dayOfWeek, [...(byDay.get(window.dayOfWeek) || []), window]);
    }

    for (const [dayOfWeek, dayWindows] of byDay) {
      const sorted = [...dayWindows].sort(
        (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
      );
      for (let index = 1; index < sorted.length; index++) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (timeToMinutes(current.startTime) < timeToMinutes(previous.endTime)) {
          throw new BadRequestException(
            `Weekly windows overlap on day ${dayOfWeek}: ${previous.startTime}-${previous.endTime} and ${current.startTime}-${current.endTime}`,
          );
        }
      }
    }
  }
}
