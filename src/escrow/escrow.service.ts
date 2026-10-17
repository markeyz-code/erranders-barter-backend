import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction, TransactionStatus } from './schemas/transaction.schema';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { LogisticsService } from '../logistics/logistics.service';
import { Item } from '../items/schemas/item.schema';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
    @InjectModel(Item.name) private itemModel: Model<Item>,
    private settingsService: SettingsService,
    private usersService: UsersService,
    private logisticsService: LogisticsService,
  ) {}

  async initiate(dto: { buyerId: string; sellerId: string; itemId: string; amount: number; deliveryMethod?: string; deliveryAddress?: string; paymentReference?: string; deliveryFee?: number }): Promise<Transaction> {
    const item = await this.itemModel.findById(dto.itemId);
    if (!item) throw new NotFoundException('Item not found');

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

    // Hand the delivery to the real logistics service. It persists a dispatch row before
    // calling the provider, so a failure is recorded as FAILED (with lastError) instead of
    // being swallowed or reported as a success.
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

    // Commission settings
    const sellerCommVal = await this.settingsService.getSetting('seller_commission_percentage');
    const sellerCommPerc = sellerCommVal ? Number(sellerCommVal) : 0;

    // Calculate payouts
    const sellerPayout = tx.itemPrice - ((tx.itemPrice * sellerCommPerc) / 100);

    // Update seller wallet
    await this.usersService.incrementWalletBalance(tx.sellerId, sellerPayout);

    // If there's an Errander, we would credit their wallet. Currently, Barter doesn't have an errander assignment flow, 
    // but the Errander's payout would be: tx.deliveryFee - ((tx.deliveryFee * erranderCommPerc) / 100).

    tx.status = TransactionStatus.RELEASED;
    return tx.save();
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