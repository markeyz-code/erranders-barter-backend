import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking, BookingStatus } from './schemas/booking.schema';
import { Service, PriceType } from '../services/schemas/service.schema';
import { User } from '../users/schemas/user.schema';
import { ChatService } from '../chat/chat.service';
import { AvailabilityService } from '../availability/availability.service';
import { buildSlotKeys, isValidTimeString } from '../availability/slot-math';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';

const SERVICE_POPULATE =
  'title description images price priceType durationMinutes bufferMinutes location isRemote isActive';
const PROVIDER_POPULATE =
  'firstName lastName avatar university hostel level rating isServiceProvider providerProfile';
const CUSTOMER_POPULATE = 'firstName lastName avatar university hostel level rating';

@Injectable()
export class BookingsService {
  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    @InjectModel(Service.name) private serviceModel: Model<Service>,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly chatService: ChatService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  /**
   * Creates a pending booking.
   *
   * Race safety has two layers:
   *  1. the requested start time is re-validated against the computed slots (correctness);
   *  2. the insert itself is guarded by unique indexes on `{providerId, date, startTime}` and
   *     on the per-minute `slotKeys` array. If two clients pass the check at the same moment,
   *     MongoDB lets exactly one insert through and the other raises E11000, which becomes a
   *     clean 409. There is no "read, decide, write" window.
   */
  async create(dto: CreateBookingDto, userId: string): Promise<Booking> {
    if (!Types.ObjectId.isValid(dto.serviceId)) throw new NotFoundException('Service not found');

    const service = await this.serviceModel.findById(dto.serviceId).exec();
    if (!service) throw new NotFoundException('Service not found');
    if (!service.isActive) {
      throw new BadRequestException('This service is not accepting bookings right now');
    }
    if (service.providerId?.toString() === userId) {
      throw new BadRequestException('You cannot book your own service');
    }

    const provider = await this.userModel
      .findById(service.providerId)
      .select('isServiceProvider providerProfile.isAcceptingBookings')
      .lean()
      .exec();
    if (!provider?.isServiceProvider) {
      throw new BadRequestException('This provider is no longer available');
    }
    if (provider.providerProfile?.isAcceptingBookings === false) {
      throw new BadRequestException('This provider has paused new bookings');
    }

    const slot = await this.resolveSlot(service, dto.date, dto.startTime);
    const providerId = service.providerId.toString();

    let chatId: any = undefined;
    try {
      const chat = await this.chatService.findOrCreateChat([userId, providerId]);
      chatId = chat?._id;
    } catch {
      // Non-fatal if chat socket/db init lags
    }

    let calculatedAmount = service.price || 0;
    if (service.priceType === PriceType.HOURLY) {
      calculatedAmount = Math.round((service.price || 0) * (service.durationMinutes / 60));
    } else if (service.priceType === PriceType.PER_MINUTE) {
      calculatedAmount = Math.round((service.price || 0) * service.durationMinutes);
    } else if (service.priceType === PriceType.NEGOTIABLE) {
      calculatedAmount = 0;
    }

    const booking = new this.bookingModel({
      serviceId: service._id,
      providerId: service.providerId,
      customerId: userId,
      date: dto.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes || 0,
      amount: calculatedAmount,
      status: BookingStatus.PENDING,
      notes: typeof dto.notes === 'string' ? dto.notes.trim() : '',
      blocksSlot: true,
      chatId,
      slotKeys: buildSlotKeys(
        providerId,
        dto.date,
        slot.startTime,
        service.durationMinutes,
        service.bufferMinutes || 0,
      ),
    });

    try {
      await booking.save();
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        throw new ConflictException(
          'That slot was just booked by someone else. Pick another available time.',
        );
      }
      throw error;
    }

    return this.findPopulated(booking._id.toString());
  }

  /** Bookings where the caller is the customer. */
  async findMine(userId: string): Promise<Booking[]> {
    return this.populate(this.bookingModel.find({ customerId: userId }))
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Bookings where the caller is the provider. */
  async findReceived(userId: string): Promise<Booking[]> {
    return this.populate(this.bookingModel.find({ providerId: userId }))
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Booking detail. Only the two participants may read it. */
  async findOne(id: string, userId: string): Promise<Booking> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Booking not found');

    const booking = await this.populate(this.bookingModel.findById(id)).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    this.assertParticipant(booking as any, userId);
    return booking as Booking;
  }

  /**
   * Provider accepts: status becomes confirmed, the customer/provider chat is created with the
   * existing ChatService, and a Jitsi room is minted only for remote services. The status
   * filter in the update makes this safe against a simultaneous cancel/decline.
   */
  async accept(id: string, userId: string): Promise<Booking> {
    const booking = await this.getDocument(id);
    this.assertProvider(booking, userId);
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(
        `Only pending bookings can be accepted (current status: ${booking.status})`,
      );
    }

    const service = await this.serviceModel
      .findById(booking.serviceId)
      .select('isRemote')
      .lean()
      .exec();
    if (!service) throw new NotFoundException('Service not found');

    const chat = await this.chatService.findOrCreateChat([
      booking.customerId.toString(),
      booking.providerId.toString(),
    ]);

    const update: any = { status: BookingStatus.CONFIRMED, chatId: chat._id };
    if (service.isRemote) {
      // Zero-infrastructure video: a deterministic Jitsi room per booking, no account or key.
      update.meetingUrl = `https://meet.jit.si/barter-${booking._id.toString()}`;
    }

    const updated = await this.bookingModel
      .findOneAndUpdate({ _id: id, status: BookingStatus.PENDING }, { $set: update }, { new: true })
      .exec();
    if (!updated) {
      throw new ConflictException('This booking changed state before it could be accepted');
    }

    return this.findPopulated(id);
  }

  async decline(id: string, userId: string, reason?: string): Promise<Booking> {
    const booking = await this.getDocument(id);
    this.assertProvider(booking, userId);
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(
        `Only pending bookings can be declined (current status: ${booking.status})`,
      );
    }

    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: id, status: BookingStatus.PENDING },
        {
          $set: {
            status: BookingStatus.DECLINED,
            blocksSlot: false,
            cancelledBy: userId,
            cancellationReason: (reason || '').trim() || 'Declined by provider',
          },
          $unset: { slotKeys: 1 },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException('This booking changed state before it could be declined');
    }

    return this.findPopulated(id);
  }

  /** Either party can cancel a pending or confirmed booking, with a reason. */
  async cancel(id: string, userId: string, reason: string): Promise<Booking> {
    const booking = await this.getDocument(id);
    this.assertParticipant(booking, userId);

    if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException(
        `Only pending or confirmed bookings can be cancelled (current status: ${booking.status})`,
      );
    }

    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason) throw new BadRequestException('A cancellation reason is required');

    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: id, status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            blocksSlot: false,
            cancelledBy: userId,
            cancellationReason: cleanReason,
          },
          $unset: { slotKeys: 1 },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException('This booking changed state before it could be cancelled');
    }

    return this.findPopulated(id);
  }

  /**
   * Provider marks a confirmed booking as completed and bumps the counters exactly once: the
   * transition is a guarded `findOneAndUpdate`, so two concurrent completes cannot both win.
   */
  async complete(id: string, userId: string): Promise<Booking> {
    const booking = await this.getDocument(id);
    this.assertProvider(booking, userId);

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException(
        `Only confirmed bookings can be completed (current status: ${booking.status})`,
      );
    }

    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: id, status: BookingStatus.CONFIRMED },
        { $set: { status: BookingStatus.COMPLETED } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException('This booking changed state before it could be completed');
    }

    await Promise.all([
      this.serviceModel
        .updateOne({ _id: updated.serviceId }, { $inc: { totalBookings: 1 } })
        .exec(),
      this.userModel
        .updateOne({ _id: updated.providerId }, { $inc: { 'providerProfile.totalBookings': 1 } })
        .exec(),
    ]);

    return this.findPopulated(id);
  }

  /**
   * Moves a pending or confirmed booking to a new time. The new slot is re-validated exactly
   * like a create (excluding this booking so it does not collide with itself), and the write
   * goes through the same unique indexes, so two people rescheduling into the same slot race
   * safely too.
   */
  async reschedule(id: string, userId: string, dto: RescheduleBookingDto): Promise<Booking> {
    const booking = await this.getDocument(id);
    this.assertParticipant(booking, userId);

    if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException(
        `Only pending or confirmed bookings can be rescheduled (current status: ${booking.status})`,
      );
    }

    const service = await this.serviceModel.findById(booking.serviceId).exec();
    if (!service || !service.isActive) {
      throw new BadRequestException('The service for this booking is no longer available');
    }

    const slot = await this.resolveSlot(service, dto.date, dto.startTime, id);
    const providerId = booking.providerId.toString();

    // The status is deliberately kept: a pending request stays pending (the provider still has
    // to accept), and a confirmed booking stays confirmed because both parties are already
    // participants and the new slot has just been validated against the provider's calendar.
    const update = {
      date: dto.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes || 0,
      amount: service.price || 0,
      slotKeys: buildSlotKeys(
        providerId,
        dto.date,
        slot.startTime,
        service.durationMinutes,
        service.bufferMinutes || 0,
      ),
      ...(typeof dto.notes === 'string' ? { notes: dto.notes.trim() } : {}),
    };

    try {
      const updated = await this.bookingModel
        .findOneAndUpdate(
          {
            _id: id,
            status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          },
          { $set: update },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new ConflictException('This booking changed state before it could be rescheduled');
      }
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        throw new ConflictException(
          'That slot is no longer free. Pick another available time.',
        );
      }
      throw error;
    }

    return this.findPopulated(id);
  }

  /**
   * Shared slot check. A start time that is not in the service's slot grid is a bad request;
   * a real slot that is taken or blocked is a conflict.
   */
  private async resolveSlot(
    service: Service,
    date: string,
    startTime: string,
    excludeBookingId?: string,
  ) {
    if (!isValidTimeString(startTime)) {
      throw new BadRequestException('startTime must be a 24-hour time like "09:00"');
    }

    const slots = await this.availabilityService.computeSlotsForService(service, date, {
      excludeBookingId,
    });
    const slot = slots.find((candidate) => candidate.startTime === startTime);
    if (!slot) {
      throw new BadRequestException(
        `${startTime} is not an available slot on ${date} for this service`,
      );
    }
    if (!slot.available) {
      throw new ConflictException('That time is already booked or blocked. Choose another slot.');
    }
    return slot;
  }

  private async getDocument(id: string): Promise<Booking> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Booking not found');
    const booking = await this.bookingModel.findById(id).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async findPopulated(id: string): Promise<Booking> {
    const booking = await this.populate(this.bookingModel.findById(id)).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private populate(query: any) {
    return query
      .populate('serviceId', SERVICE_POPULATE)
      .populate('providerId', PROVIDER_POPULATE)
      .populate('customerId', CUSTOMER_POPULATE);
  }

  private assertParticipant(booking: Booking, userId: string): void {
    const isProvider = this.refId(booking.providerId) === userId;
    const isCustomer = this.refId(booking.customerId) === userId;
    if (!isProvider && !isCustomer) {
      throw new ForbiddenException('You are not a participant in this booking');
    }
  }

  private assertProvider(booking: Booking, userId: string): void {
    if (this.refId(booking.providerId) !== userId) {
      throw new ForbiddenException('Only the provider can perform this action');
    }
  }

  /**
   * A ref is an ObjectId on a raw document but a populated User document on a populated one;
   * both must compare equal to the JWT's userId. Mongoose's Document#toString() is *not* the
   * id, so populated refs are resolved through `_id` first.
   */
  private refId(value: any): string {
    if (!value) return '';
    if (value._id !== undefined) return value._id.toString();
    return value.toString();
  }

  /** MongoDB duplicate-key error, whether raw or wrapped by Mongoose. */
  private isDuplicateKey(error: any): boolean {
    return error?.code === 11000 || error?.cause?.code === 11000;
  }
}
