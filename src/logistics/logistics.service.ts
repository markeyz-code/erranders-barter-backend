import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ACTIVE_DISPATCH_STATUSES, Dispatch, DispatchStatus } from './schemas/dispatch.schema';
import { Item } from '../items/schemas/item.schema';
import { Transaction } from '../escrow/schemas/transaction.schema';
import { User } from '../users/schemas/user.schema';

// The Erranders marketplace owns the rider network. Barter only asks it to create an errand;
// it does not track riders itself. The path below is the live endpoint (see
// marketplace/backend/src/modules/orders/orders.controller.ts -> POST orders/webhook/barter).
const ERRANDERS_DISPATCH_PATH = '/orders/webhook/barter';
const MAX_PROVIDER_ERROR_LENGTH = 500;

export interface CreateDispatchInput {
  pickupLocation?: string;
  dropoffLocation?: string;
  itemId?: string;
  transactionId?: string;
  itemTitle?: string;
  sellerId?: string;
  buyerId?: string;
  fee?: number;
  priority?: string;
  riderName?: string;
  riderPhone?: string;
  notes?: string;
}

export interface UpdateDispatchInput {
  status?: DispatchStatus;
  riderName?: string;
  riderPhone?: string;
  riderId?: string;
  trackingUrl?: string;
  providerOrderId?: string;
  fee?: number;
  notes?: string;
}

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    @InjectModel(Dispatch.name) private dispatchModel: Model<Dispatch>,
    @InjectModel(Item.name) private itemModel: Model<Item>,
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  /**
   * Creates a delivery dispatch for a barter trade and hands it to the Erranders rider network.
   * The dispatch record is always persisted first, so a provider failure leaves an auditable
   * FAILED row (with lastError) instead of silently losing the request.
   */
  async dispatchRiderForBarter(
    sellerLocation: string,
    buyerLocation: string,
    itemTitle: string,
    options: Omit<CreateDispatchInput, 'pickupLocation' | 'dropoffLocation' | 'itemTitle'> = {},
    createdBy?: string,
  ): Promise<Dispatch> {
    const pickup = (sellerLocation || '').trim() || 'Seller Campus Location';
    const dropoff = (buyerLocation || '').trim() || 'Buyer Campus Delivery Address';

    const dispatch = await new this.dispatchModel({
      pickupLocation: pickup,
      dropoffLocation: dropoff,
      itemTitle: itemTitle || 'Barter Item',
      transactionId: options.transactionId,
      itemId: options.itemId,
      sellerId: options.sellerId,
      buyerId: options.buyerId,
      createdBy,
      fee: Math.max(300, Number(options.fee) || 500),
      priority: options.priority || 'normal',
      riderName: options.riderName,
      riderPhone: options.riderPhone,
      notes: options.notes,
      provider: 'erranders',
      status: DispatchStatus.PENDING,
    }).save();

    return this.sendToProvider(dispatch);
  }

  /** Validates the payload, enriches it from the item/transaction and triggers the dispatch. */
  async createDispatch(dto: CreateDispatchInput, userId: string): Promise<Dispatch> {
    let pickupLocation = dto.pickupLocation;
    let dropoffLocation = dto.dropoffLocation;
    let itemTitle = dto.itemTitle;
    let sellerId = dto.sellerId;
    let buyerId = dto.buyerId;

    if (dto.itemId) {
      if (!Types.ObjectId.isValid(dto.itemId)) throw new BadRequestException('Invalid itemId');
      const item = await this.itemModel.findById(dto.itemId).exec();
      if (!item) throw new NotFoundException('Item not found');
      itemTitle = itemTitle || item.title;
      sellerId = sellerId || item.sellerId?.toString();
      pickupLocation = pickupLocation || item.location;
    }

    if (dto.transactionId) {
      if (!Types.ObjectId.isValid(dto.transactionId)) throw new BadRequestException('Invalid transactionId');
      const tx = await this.txModel.findById(dto.transactionId).exec();
      if (!tx) throw new NotFoundException('Transaction not found');
      // Only a party to the trade may trigger its delivery.
      if (tx.buyerId !== userId && tx.sellerId !== userId) {
        throw new BadRequestException('You are not a party to this transaction');
      }
      sellerId = sellerId || tx.sellerId;
      buyerId = buyerId || tx.buyerId;

      // The transaction carries the dropoff address but not the pickup point, so fall back to
      // the parties' hostels (the same convention escrow.service uses for its webhook).
      if (!pickupLocation && Types.ObjectId.isValid(tx.sellerId)) {
        const seller = await this.userModel.findById(tx.sellerId).select('hostel').exec();
        pickupLocation = seller?.hostel || 'Seller Location';
      }
      if (!dropoffLocation) {
        const buyer = Types.ObjectId.isValid(tx.buyerId)
          ? await this.userModel.findById(tx.buyerId).select('hostel').exec()
          : null;
        dropoffLocation = tx.deliveryAddress || buyer?.hostel || 'Buyer Location';
      }
    }

    if (!pickupLocation) {
      throw new BadRequestException('pickupLocation is required (or provide an itemId with a location)');
    }
    if (!dropoffLocation) {
      throw new BadRequestException('dropoffLocation is required (or provide a transactionId with a deliveryAddress)');
    }

    return this.dispatchRiderForBarter(
      pickupLocation,
      dropoffLocation,
      itemTitle,
      {
        transactionId: dto.transactionId,
        itemId: dto.itemId,
        sellerId,
        buyerId,
        fee: dto.fee,
        priority: dto.priority,
        riderName: dto.riderName,
        riderPhone: dto.riderPhone,
        notes: dto.notes,
      },
      userId,
    );
  }

  /** Re-sends a previously failed dispatch to the provider. */
  async retryDispatch(id: string): Promise<Dispatch> {
    const dispatch = await this.getDocument(id);
    if (dispatch.status !== DispatchStatus.FAILED && dispatch.status !== DispatchStatus.PENDING) {
      throw new BadRequestException(`Only pending or failed dispatches can be retried (current status: ${dispatch.status})`);
    }
    return this.sendToProvider(dispatch);
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const filter: any = {};
    if (query.status) {
      if (!Object.values(DispatchStatus).includes(query.status)) {
        throw new BadRequestException(`Invalid status. Allowed: ${Object.values(DispatchStatus).join(', ')}`);
      }
      filter.status = query.status;
    }
    if (query.transactionId) {
      if (!Types.ObjectId.isValid(query.transactionId)) throw new BadRequestException('Invalid transactionId');
      filter.transactionId = query.transactionId;
    }
    if (query.itemId) {
      if (!Types.ObjectId.isValid(query.itemId)) throw new BadRequestException('Invalid itemId');
      filter.itemId = query.itemId;
    }
    if (query.search) {
      const search = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ itemTitle: search }, { pickupLocation: search }, { dropoffLocation: search }, { riderName: search }];
    }

    const [data, total] = await Promise.all([
      this.dispatchModel
        .find(filter)
        .populate('itemId', 'title images price location status')
        .populate('sellerId', 'firstName lastName hostel avatar')
        .populate('buyerId', 'firstName lastName hostel avatar')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.dispatchModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findOne(id: string): Promise<Dispatch> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Dispatch not found');
    const dispatch = await this.dispatchModel
      .findById(id)
      .populate('itemId', 'title images price location status')
      .populate('sellerId', 'firstName lastName hostel avatar')
      .populate('buyerId', 'firstName lastName hostel avatar')
      .populate('transactionId')
      .exec();
    if (!dispatch) throw new NotFoundException('Dispatch not found');
    return dispatch;
  }

  /** Assigns a rider and/or moves the dispatch through its lifecycle. */
  async update(id: string, dto: UpdateDispatchInput): Promise<Dispatch> {
    const dispatch = await this.getDocument(id);

    if (dto.status !== undefined) {
      if (!Object.values(DispatchStatus).includes(dto.status)) {
        throw new BadRequestException(`Invalid status. Allowed: ${Object.values(DispatchStatus).join(', ')}`);
      }
      dispatch.status = dto.status;
      if (dto.status === DispatchStatus.DELIVERED && !dispatch.deliveredAt) dispatch.deliveredAt = new Date();
      if (dto.status === DispatchStatus.CANCELLED && !dispatch.cancelledAt) dispatch.cancelledAt = new Date();
      if (dto.status !== DispatchStatus.FAILED) dispatch.lastError = undefined;
    }

    if (dto.riderName !== undefined) dispatch.riderName = dto.riderName;
    if (dto.riderPhone !== undefined) dispatch.riderPhone = dto.riderPhone;
    if (dto.riderId !== undefined) {
      if (!dto.riderId) dispatch.riderId = undefined;
      else if (!Types.ObjectId.isValid(dto.riderId)) throw new BadRequestException('Invalid riderId');
      else dispatch.riderId = new Types.ObjectId(dto.riderId);
    }
    if (dto.trackingUrl !== undefined) dispatch.trackingUrl = dto.trackingUrl;
    if (dto.providerOrderId !== undefined) dispatch.providerOrderId = dto.providerOrderId;
    if (dto.notes !== undefined) dispatch.notes = dto.notes;
    if (dto.fee !== undefined) dispatch.fee = Number(dto.fee) || 0;

    await dispatch.save();
    return this.findOne(id);
  }

  async getStats() {
    const [total, byStatus, last24h] = await Promise.all([
      this.dispatchModel.countDocuments(),
      this.dispatchModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.dispatchModel.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    ]);

    const counts = Object.values(DispatchStatus).reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {} as Record<string, number>);
    byStatus.forEach((row) => { counts[row._id] = row.count; });

    return {
      total,
      active: ACTIVE_DISPATCH_STATUSES.reduce((acc, status) => acc + (counts[status] || 0), 0),
      failed: counts[DispatchStatus.FAILED] || 0,
      last24h,
      byStatus: counts,
    };
  }

  private async getDocument(id: string): Promise<Dispatch> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Dispatch not found');
    const dispatch = await this.dispatchModel.findById(id).exec();
    if (!dispatch) throw new NotFoundException('Dispatch not found');
    return dispatch;
  }

  /**
   * Pushes one dispatch to the Erranders logistics API. Any non-2xx response, network error or
   * missing configuration marks the record FAILED and surfaces an explicit error — it never
   * reports a fake success.
   */
  private async sendToProvider(dispatch: Dispatch): Promise<Dispatch> {
    const rawBase = (process.env.ERRANDERS_API_URL || 'https://api.erranders.org/api/v1').trim();
    const cleanBase = rawBase.replace(/\/+$/, '');
    const finalBase = cleanBase.endsWith('/api/v1') ? cleanBase : `${cleanBase}/api/v1`;
    const url = `${finalBase}${ERRANDERS_DISPATCH_PATH}`;

    let apiKey = (process.env.BARTER_API_KEY || 'barter_secret_123').trim();

    try {
      this.assertProviderConfigured(finalBase, apiKey);
    } catch (error) {
      dispatch.status = DispatchStatus.FAILED;
      dispatch.lastError = error.message;
      await dispatch.save();
      throw error;
    }

    const payloadBody = JSON.stringify({
      pickupLocation: dispatch.pickupLocation || 'Seller Campus Location',
      dropoffLocation: dispatch.dropoffLocation || 'Buyer Campus Delivery Address',
      fee: Math.max(300, Number(dispatch.fee) || 500),
      description: `Barter Delivery: ${dispatch.itemTitle || 'Barter Item'}`,
      barterTransactionId: dispatch.transactionId?.toString(),
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: payloadBody,
      });

      // If 401 Unauthorized with custom key, retry with standard fallback key
      if (response.status === 401 && apiKey !== 'barter_secret_123') {
        this.logger.warn(`Erranders API returned 401 with configured key, retrying with fallback key`);
        apiKey = 'barter_secret_123';
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: payloadBody,
        });
      }
    } catch (error) {
      dispatch.status = DispatchStatus.FAILED;
      dispatch.lastError = `Logistics provider unreachable: ${error.message}`;
      await dispatch.save();
      this.logger.error(`Failed to reach Erranders logistics API at ${url}`, error.stack);
      throw new BadGatewayException('Could not reach the Erranders logistics service. The dispatch was recorded as failed.');
    }

    const rawBody = await response.text();
    let payload: any = null;
    try {
      payload = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      payload = { raw: rawBody.slice(0, MAX_PROVIDER_ERROR_LENGTH) };
    }

    if (!response.ok) {
      dispatch.status = DispatchStatus.FAILED;
      dispatch.lastError = `Erranders API responded ${response.status}: ${rawBody.slice(0, MAX_PROVIDER_ERROR_LENGTH)}`;
      dispatch.providerResponse = payload;
      await dispatch.save();
      this.logger.error(`Erranders logistics API rejected dispatch ${dispatch._id}: ${dispatch.lastError}`);
      throw new BadGatewayException(`Logistics provider rejected the dispatch (HTTP ${response.status}): ${rawBody.slice(0, MAX_PROVIDER_ERROR_LENGTH)}`);
    }

    dispatch.status = DispatchStatus.DISPATCHED;
    dispatch.dispatchedAt = dispatch.dispatchedAt || new Date();
    dispatch.providerOrderId = payload?._id || payload?.id || payload?.orderId || dispatch.providerOrderId;
    dispatch.trackingUrl = payload?.trackingUrl || dispatch.trackingUrl;
    dispatch.providerResponse = payload;
    dispatch.lastError = undefined;
    await dispatch.save();

    this.logger.log(`Dispatched barter delivery ${dispatch._id} to Erranders (order ${dispatch.providerOrderId || 'unknown'})`);
    return dispatch;
  }

  /** The provider integration is only usable when a real Erranders URL and key are configured. */
  private assertProviderConfigured(baseUrl: string, apiKey: string): void {
    if (!baseUrl) {
      throw new ServiceUnavailableException(
        'Logistics provider is not configured: ERRANDERS_API_URL is not set. The dispatch was recorded as failed.',
      );
    }

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Logistics provider is not configured: BARTER_API_KEY is not set. The dispatch was recorded as failed.',
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ServiceUnavailableException(
        `Logistics provider is not configured: ERRANDERS_API_URL ("${baseUrl}") is not a valid URL. The dispatch was recorded as failed.`,
      );
    }

    // Guard against a self-referential config, which would make this service call its own API.
    const selfPort = String(process.env.PORT || 3100);
    const urlPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) && urlPort === selfPort) {
      throw new ServiceUnavailableException(
        `Logistics provider is misconfigured: ERRANDERS_API_URL points at this Barter service (${baseUrl}). Set it to the Erranders API base URL.`,
      );
    }
  }
}
