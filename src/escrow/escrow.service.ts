import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction, TransactionStatus } from './schemas/transaction.schema';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { LogisticsService } from '../logistics/logistics.service';
import { Item, ItemStatus } from '../items/schemas/item.schema';
import { User } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
    @InjectModel(Item.name) private itemModel: Model<Item>,
    @InjectModel(User.name) private userModel: Model<User>,
    private settingsService: SettingsService,
    private usersService: UsersService,
    private logisticsService: LogisticsService,
    private notificationsService: NotificationsService,
  ) {}

  async initiate(dto: { buyerId: string; sellerId: string; itemId: string; amount: number; deliveryMethod?: string; deliveryAddress?: string; paymentReference?: string; deliveryFee?: number }): Promise<Transaction> {
    if (dto.buyerId === dto.sellerId) {
      throw new BadRequestException('You cannot purchase your own item');
    }

    const item = await this.itemModel.findById(dto.itemId);
    if (!item) throw new NotFoundException('Item not found');

    if (item.status === ItemStatus.SOLD) {
      throw new BadRequestException('This item is already sold out and no longer available.');
    }
    if (item.status === ItemStatus.PENDING) {
      throw new BadRequestException('This item is currently reserved in an ongoing escrow transaction.');
    }
    if (item.status !== ItemStatus.ACTIVE) {
      throw new BadRequestException(`This item is not available for purchase (current status: ${item.status}).`);
    }

    // Atomic compare-and-swap lock to prevent race condition double-buys
    const lockedItem = await this.itemModel.findOneAndUpdate(
      { _id: dto.itemId, status: ItemStatus.ACTIVE },
      { $set: { status: ItemStatus.PENDING } },
      { new: true },
    );
    if (!lockedItem) {
      throw new BadRequestException('This item was just reserved or purchased by another student. Please refresh.');
    }

    let deliveryFee = 0;
    if (dto.deliveryMethod === 'errander') {
      if (dto.deliveryFee !== undefined && dto.deliveryFee !== null) {
        deliveryFee = Number(dto.deliveryFee);
        if (Number.isNaN(deliveryFee) || deliveryFee < 0) {
          throw new BadRequestException('deliveryFee must be a positive number');
        }
      } else {
        // The base fee is platform configuration, never a number invented here.
        const configuredBaseFee = await this.settingsService.getSetting('base_errander_fee');
        if (configuredBaseFee === null || configuredBaseFee === undefined) {
          throw new BadRequestException(
            'Errander delivery is not priced yet: base_errander_fee is not configured. Ask an admin to set it.',
          );
        }
        deliveryFee = Number(configuredBaseFee);
      }
    }

    const escrowFeePercVal = await this.settingsService.getSetting('escrow_fee_percentage');
    if (escrowFeePercVal === null || escrowFeePercVal === undefined) {
      throw new BadRequestException(
        'Escrow is not priced yet: escrow_fee_percentage is not configured. Ask an admin to set it.',
      );
    }
    const escrowFeePerc = Number(escrowFeePercVal);
    
    // We know itemPrice.
    const itemPrice = item.price;
    // Calculate escrow fee based on itemPrice + deliveryFee
    const baseTotal = itemPrice + deliveryFee;
    const escrowFee = (baseTotal * escrowFeePerc) / 100;
    
    // Create tx
    const tx = new this.txModel({ 
      ...dto,
      itemPrice,
      deliveryFee,
      escrowFee,
      status: TransactionStatus.HELD_IN_ESCROW 
    });
    const savedTx = await tx.save();

    // Trigger aggressive in-app notifications and email to seller & buyer
    void (async () => {
      try {
        const [seller, buyer] = await Promise.all([
          this.userModel.findById(dto.sellerId).lean().exec(),
          this.userModel.findById(dto.buyerId).lean().exec(),
        ]);
        const buyerName = buyer ? `${buyer.firstName || ''} ${buyer.lastName || ''}`.trim() || 'A student' : 'A student';
        const sellerName = seller ? `${seller.firstName || ''} ${seller.lastName || ''}`.trim() || 'Student' : 'Student';

        await this.notificationsService.create({
          userId: dto.sellerId,
          actorId: dto.buyerId,
          title: 'Escrow Payment Received! 💰',
          message: `${buyerName} initiated escrow payment of ₦${savedTx.amount.toLocaleString()} for "${item.title}". Item is now reserved.`,
          type: 'trade_requested' as any,
          link: '/escrow',
          metadata: { transactionId: savedTx._id.toString(), itemId: item._id.toString() },
        });

        if (seller?.email) {
          await this.notificationsService.getEmailService().sendEscrowInitiated(
            seller.email,
            sellerName,
            buyerName,
            item.title,
            savedTx.amount,
          );
        }
      } catch (err) {
        this.logger.error(`Failed to dispatch escrow initiation notifications: ${err?.message || err}`);
      }
    })();

    // Hand the delivery to the real logistics service
    if (dto.deliveryMethod === 'errander') {
      try {
        const seller = await this.usersService.findById(dto.sellerId);
        const buyer = await this.usersService.findById(dto.buyerId);
        await this.logisticsService.dispatchRiderForBarter(
          seller?.hostel || '',
          dto.deliveryAddress || buyer?.hostel || '',
          item.title,
          {
            transactionId: savedTx._id.toString(),
            itemId: item._id.toString(),
            sellerId: dto.sellerId,
            buyerId: dto.buyerId,
            fee: deliveryFee,
          },
          dto.buyerId,
        );
      } catch (err: any) {
        this.logger.error(
          `Escrow ${savedTx._id} was created but the delivery dispatch failed: ${err?.message || err}`,
        );
      }
    }

    return savedTx;
  }

  async release(txId: string, buyerId: string): Promise<Transaction> {
    const tx = await this.txModel.findById(txId);
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== buyerId) throw new BadRequestException('Only the buyer can release funds');
    if (tx.status !== TransactionStatus.HELD_IN_ESCROW) throw new BadRequestException('Funds already released or disputed');

    const { payout: sellerPayout } = await this.computeSellerPayout(tx);

    // Update seller wallet
    if (sellerPayout > 0) {
      await this.usersService.incrementWalletBalance(tx.sellerId, sellerPayout);
    }

    tx.status = TransactionStatus.RELEASED;
    const savedTx = await tx.save();

    // Mark item as SOLD OUT permanently
    await this.itemModel.findByIdAndUpdate(tx.itemId, { $set: { status: ItemStatus.SOLD } }).exec();

    // Aggressive completion notifications & email
    void (async () => {
      try {
        const [seller, buyer, item] = await Promise.all([
          this.userModel.findById(tx.sellerId).lean().exec(),
          this.userModel.findById(tx.buyerId).lean().exec(),
          this.itemModel.findById(tx.itemId).lean().exec(),
        ]);
        const buyerName = buyer ? `${buyer.firstName || ''} ${buyer.lastName || ''}`.trim() || 'The buyer' : 'The buyer';
        const sellerName = seller ? `${seller.firstName || ''} ${seller.lastName || ''}`.trim() || 'Student' : 'Student';
        const itemTitle = item?.title || 'Your item';

        await this.notificationsService.create({
          userId: tx.sellerId,
          title: 'Funds Released! Item Sold Out 🚀',
          message: `${buyerName} confirmed receipt of "${itemTitle}". ₦${sellerPayout.toLocaleString()} credited to your wallet!`,
          type: 'trade_completed' as any,
          link: '/dashboard/wallet',
          metadata: { transactionId: tx._id.toString(), payout: sellerPayout, itemId: tx.itemId },
        });

        if (seller?.email) {
          await this.notificationsService.getEmailService().sendItemSoldOut(
            seller.email,
            sellerName,
            itemTitle,
            buyerName,
            sellerPayout,
          );
        }
      } catch (err) {
        this.logger.error(`Failed to dispatch escrow release notifications: ${err?.message || err}`);
      }
    })();

    return savedTx;
  }

  /** Seller payout and platform commission for a transaction, using the live setting. */
  private async computeSellerPayout(tx: Transaction) {
    const sellerCommVal = await this.settingsService.getSetting('seller_commission_percentage');
    const sellerCommPerc = sellerCommVal ? Number(sellerCommVal) : 0;
    const itemPrice = Number(tx.itemPrice || 0);
    const commission = this.roundMoney((itemPrice * sellerCommPerc) / 100);
    const payout = this.roundMoney(itemPrice - commission);
    return { payout, commission, percentage: sellerCommPerc };
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  async dispute(txId: string, userId: string): Promise<Transaction> {
    const tx = await this.txModel.findById(txId);
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== userId && tx.sellerId !== userId) throw new BadRequestException('Not a party to this transaction');

    tx.status = TransactionStatus.DISPUTED;
    const savedTx = await tx.save();

    if (tx.erranderOrderId) {
      try {
        const { apiUrl, apiKey } = this.requireProviderConfig();
        const response = await fetch(`${apiUrl}/orders/webhook/dispute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            orderId: tx.erranderOrderId
          })
        });

        if (!response.ok) {
          this.logger.error(
            `Dispute ${tx._id} was recorded, but Erranders rejected the dispute webhook (HTTP ${response.status}).`,
          );
        }
      } catch (e: any) {
        // The dispute itself is already persisted; only the provider notification failed.
        this.logger.error(`Dispute ${tx._id} was recorded, but the Erranders webhook failed: ${e?.message || e}`);
      }
    }

    return savedTx;
  }

  async findByUser(userId: string): Promise<Transaction[]> {
    return this.txModel.find({ $or: [{ buyerId: userId }, { sellerId: userId }] }).sort({ createdAt: -1 }).exec();
  }

  async findAll(): Promise<Transaction[]> {
    return this.txModel.find().sort({ createdAt: -1 }).exec();
  }

  /**
   * Admin escrow list. `buyerId`/`sellerId`/`itemId` are plain string columns in this
   * schema (not ObjectId refs), so they cannot be populated by Mongoose. The related
   * documents are looked up explicitly and attached as `buyer`, `seller` and `item` so the
   * admin screen can resolve names without inventing anything.
   */
  async findForAdmin(query: any = {}) {
    const filter: any = {};
    if (query.status) {
      if (!Object.values(TransactionStatus).includes(query.status)) {
        throw new BadRequestException(
          `Invalid status. Allowed: ${Object.values(TransactionStatus).join(', ')}`,
        );
      }
      filter.status = query.status;
    }
    if (query.search) {
      // Only ids are searchable without a populate on these string columns.
      const search = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ buyerId: search }, { sellerId: search }, { itemId: search }];
    }

    const limit = Math.min(500, Math.max(1, Number(query.limit) || 200));
    const transactions = await this.txModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec();

    const userIds = Array.from(
      new Set(
        transactions
          .flatMap((tx) => [tx.buyerId, tx.sellerId])
          .filter((id) => typeof id === 'string' && Types.ObjectId.isValid(id)),
      ),
    );
    const itemIds = Array.from(
      new Set(
        transactions
          .map((tx) => tx.itemId)
          .filter((id) => typeof id === 'string' && Types.ObjectId.isValid(id)),
      ),
    );

    const [users, items] = await Promise.all([
      userIds.length
        ? this.userModel
            .find({ _id: { $in: userIds } })
            .select('firstName lastName email avatar isVerified isActive')
            .lean()
            .exec()
        : Promise.resolve([]),
      itemIds.length
        ? this.itemModel
            .find({ _id: { $in: itemIds } })
            .select('title images price location status isActive')
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map((user: any) => [user._id.toString(), user]));
    const itemMap = new Map(items.map((item: any) => [item._id.toString(), item]));

    return transactions.map((tx: any) => ({
      ...tx,
      buyer: userMap.get(String(tx.buyerId)) || null,
      seller: userMap.get(String(tx.sellerId)) || null,
      item: itemMap.get(String(tx.itemId)) || null,
      canResolve:
        tx.status === TransactionStatus.HELD_IN_ESCROW ||
        tx.status === TransactionStatus.DISPUTED,
    }));
  }

  /**
   * Resolves an escrow dispute as an admin.
   *
   * `release` pays the seller their item price minus the configured seller commission
   * (the same calculation the buyer's release uses). `refund` returns the full amount the
   * buyer paid to the buyer's Barter wallet, from which they can withdraw it — Barter has
   * no card-refund integration, so crediting the wallet is the real, auditable refund path.
   *
   * Safety: the status transition is an atomic compare-and-set before any wallet is
   * credited, so two operators (or a double-click) can never both pay out. If the credit
   * fails the status is reverted and the endpoint returns an error rather than a fake
   * success.
   */
  async resolveDispute(
    txId: string,
    resolution: 'release' | 'refund',
    note: string | undefined,
    adminUserId: string,
  ) {
    if (!Types.ObjectId.isValid(txId)) throw new NotFoundException('Transaction not found');
    if (resolution !== 'release' && resolution !== 'refund') {
      throw new BadRequestException("resolution must be 'release' or 'refund'");
    }

    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';
    const tx = await this.txModel.findById(txId).exec();
    if (!tx) throw new NotFoundException('Transaction not found');

    const resolvable =
      tx.status === TransactionStatus.HELD_IN_ESCROW || tx.status === TransactionStatus.DISPUTED;
    if (!resolvable) {
      throw new ConflictException(
        `This transaction is already ${tx.status} and cannot be resolved again.`,
      );
    }

    const refundAmount = this.roundMoney(Number(tx.amount || 0));
    if (resolution === 'refund' && refundAmount <= 0) {
      throw new BadRequestException(
        'This transaction has no amount to refund (transaction amount is ₦0).',
      );
    }

    const { payout: sellerPayout, commission: sellerCommission } =
      await this.computeSellerPayout(tx);

    const targetStatus =
      resolution === 'release' ? TransactionStatus.RELEASED : TransactionStatus.REFUNDED;

    // Claim the transaction atomically. If another request changed it first, this returns
    // null and we refuse rather than paying twice.
    const claimed = await this.txModel
      .findOneAndUpdate(
        { _id: tx._id, status: tx.status },
        {
          $set: {
            status: targetStatus,
            resolution,
            resolutionNote: cleanNote || undefined,
            resolvedBy: adminUserId,
            resolvedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();

    if (!claimed) {
      throw new ConflictException(
        'This transaction was resolved by another operator. Refresh and try again.',
      );
    }

    let amountMoved = 0;
    const recipientId = resolution === 'release' ? tx.sellerId : tx.buyerId;

    try {
      if (resolution === 'release') {
        if (sellerPayout > 0) {
          const credited = await this.usersService.incrementWalletBalance(tx.sellerId, sellerPayout);
          if (!credited) throw new Error('the seller account no longer exists');
          amountMoved = sellerPayout;
        }
        await this.txModel
          .updateOne(
            { _id: claimed._id },
            { $set: { sellerPayout, sellerCommission } },
          )
          .exec();
      } else {
        const credited = await this.usersService.incrementWalletBalance(tx.buyerId, refundAmount);
        if (!credited) throw new Error('the buyer account no longer exists');
        amountMoved = refundAmount;
        await this.txModel
          .updateOne({ _id: claimed._id }, { $set: { refundAmount } })
          .exec();
      }

      // Sync item status lifecycle
      const newItemStatus = resolution === 'release' ? ItemStatus.SOLD : ItemStatus.ACTIVE;
      await this.itemModel.findByIdAndUpdate(tx.itemId, { $set: { status: newItemStatus } }).exec();
    } catch (error: any) {
      // No money moved (or the credit threw before committing), so put the transaction
      // back exactly where it was and report the failure.
      await this.txModel
        .updateOne(
          { _id: claimed._id },
          {
            $set: { status: tx.status },
            $unset: {
              resolution: 1,
              resolutionNote: 1,
              resolvedBy: 1,
              resolvedAt: 1,
              sellerPayout: 1,
              sellerCommission: 1,
              refundAmount: 1,
            },
          },
        )
        .exec();

      this.logger.error(
        `Admin escrow resolution ${txId} (${resolution}) failed and was reverted: ${error?.message || error}`,
      );
      throw new InternalServerErrorException(
        `The transaction was not resolved because the wallet credit failed: ${error?.message || 'unknown error'}. No funds were moved and the status was left unchanged.`,
      );
    }

    this.logger.log(
      `Admin ${adminUserId} resolved escrow ${txId} as ${resolution}: ₦${amountMoved} credited to ${recipientId}. Note: ${cleanNote || 'none'}`,
    );

    const updated: any = await this.txModel.findById(claimed._id).lean().exec();
    return {
      ...updated,
      resolution,
      amountMoved,
      moneyMoved: amountMoved > 0,
      recipient: resolution === 'release' ? 'seller' : 'buyer',
      message:
        resolution === 'release'
          ? amountMoved > 0
            ? `Released ₦${amountMoved.toLocaleString('en-NG')} to the seller.`
            : 'Transaction released. There was no cash payout because the item price is ₦0.'
          : `Refunded ₦${amountMoved.toLocaleString('en-NG')} to the buyer's wallet.`,
    };
  }

  async handleNegotiationWebhook(payload: { barterTransactionId: string; orderId: string; bidId: string; proposedFee: number }) {
    const tx = await this.txModel.findById(payload.barterTransactionId);
    if (!tx) throw new NotFoundException('Transaction not found');
    
    tx.erranderOrderId = payload.orderId;
    tx.erranderBidId = payload.bidId;
    tx.proposedDeliveryFee = payload.proposedFee;
    
    return tx.save();
  }

  async handleAcceptWebhook(payload: { barterTransactionId: string; orderId: string; bidId: string; finalFee: number }) {
    const tx = await this.txModel.findById(payload.barterTransactionId);
    if (!tx) throw new NotFoundException('Transaction not found');
    
    tx.deliveryFee = payload.finalFee;
    tx.proposedDeliveryFee = 0;
    
    return tx.save();
  }

  async acceptNegotiation(txId: string, buyerId: string) {
    const tx = await this.txModel.findById(txId);
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== buyerId) throw new BadRequestException('Only the buyer can accept negotiations');
    if (!tx.erranderBidId) throw new BadRequestException('No negotiation exists for this transaction');

    const { apiUrl, apiKey } = this.requireProviderConfig();

    try {
      // Call Erranders backend to accept the bid
      const response = await fetch(`${apiUrl}/orders/webhook/negotiation/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          orderId: tx.erranderOrderId,
          bidId: tx.erranderBidId
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to accept negotiation on Erranders backend');
      }

      tx.deliveryFee = tx.proposedDeliveryFee;
      tx.proposedDeliveryFee = 0; // clear it
      tx.erranderBidId = null; // clear it
      return tx.save();
    } catch (err) {
      console.error(err);
      throw new BadRequestException('Could not accept negotiation');
    }
  }

  async counterNegotiation(txId: string, buyerId: string, amount: number) {
    const tx = await this.txModel.findById(txId);
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== buyerId) throw new BadRequestException('Only the buyer can negotiate');
    if (!tx.erranderBidId) throw new BadRequestException('No negotiation exists for this transaction');

    const { apiUrl, apiKey } = this.requireProviderConfig();

    try {
      const response = await fetch(`${apiUrl}/orders/webhook/negotiation/counter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          orderId: tx.erranderOrderId,
          bidId: tx.erranderBidId,
          counterAmount: amount
        })
      });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error('Failed to counter negotiation on Erranders backend: ' + text);
      }

      tx.proposedDeliveryFee = amount;
      return tx.save();
    } catch (err) {
      this.logger.error(`Could not counter negotiation for ${txId}: ${err?.message || err}`);
      throw new BadRequestException('Could not counter negotiation');
    }
  }

  /**
   * The Erranders integration is only usable with a real base URL and API key. There are
   * deliberately no placeholder credentials: a fake key would produce confusing 401s.
   */
  private requireProviderConfig(): { apiUrl: string; apiKey: string } {
    const apiUrl = (process.env.ERRANDERS_API_URL || '').trim().replace(/\/+$/, '');
    const apiKey = (process.env.BARTER_API_KEY || '').trim();

    if (!apiUrl || !apiKey) {
      throw new ServiceUnavailableException(
        'The Erranders logistics integration is not configured: ERRANDERS_API_URL and BARTER_API_KEY must be set.',
      );
    }

    return { apiUrl, apiKey };
  }
}