import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { Item, ItemStatus } from '../items/schemas/item.schema';
import { Transaction, TransactionStatus } from '../escrow/schemas/transaction.schema';
import { Withdrawal, WithdrawalStatus } from '../withdrawals/schemas/withdrawal.schema';
import { Service } from '../services/schemas/service.schema';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';

interface EscrowStatusBucket {
  _id: string;
  count: number;
  value: number;
  escrowFees: number;
  sellerCommissions: number;
}

interface WithdrawalStatusBucket {
  _id: string;
  count: number;
  value: number;
}

interface BookingStatusBucket {
  _id: string;
  count: number;
  value: number;
}

/**
 * Platform counters for the admin dashboard.
 *
 * Every number is a real aggregation over the collections this API owns — there are no
 * defaults or sample values.
 */
@Injectable()
export class AdminStatsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Item.name) private readonly itemModel: Model<Item>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
    @InjectModel(Service.name) private readonly serviceModel: Model<Service>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
  ) {}

  async getStats() {
    const [
      userTotal,
      userVerified,
      userSuspended,
      userAdmins,
      userProviders,
      itemTotal,
      itemActive,
      itemInactive,
      itemPromoted,
      itemPending,
      itemSold,
      itemCompleted,
      serviceTotal,
      serviceActive,
      serviceRemote,
      escrowBuckets,
      withdrawalBuckets,
      bookingBuckets,
    ] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({ isVerified: true }),
      this.userModel.countDocuments({ isActive: false }),
      this.userModel.countDocuments({ isAdmin: true }),
      this.userModel.countDocuments({ isServiceProvider: true }),
      this.itemModel.countDocuments(),
      this.itemModel.countDocuments({ status: ItemStatus.ACTIVE, isActive: { $ne: false } }),
      this.itemModel.countDocuments({ isActive: false }),
      this.itemModel.countDocuments({ isPromoted: true }),
      this.itemModel.countDocuments({ status: ItemStatus.PENDING }),
      this.itemModel.countDocuments({ status: ItemStatus.SOLD }),
      this.itemModel.countDocuments({ status: ItemStatus.COMPLETED }),
      this.serviceModel.countDocuments(),
      this.serviceModel.countDocuments({ isActive: true }),
      this.serviceModel.countDocuments({ isRemote: true, isActive: true }),
      this.txModel.aggregate<EscrowStatusBucket>([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ['$amount', 0] } },
            escrowFees: { $sum: { $ifNull: ['$escrowFee', 0] } },
            sellerCommissions: { $sum: { $ifNull: ['$sellerCommission', 0] } },
          },
        },
      ]),
      this.withdrawalModel.aggregate<WithdrawalStatusBucket>([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ['$amount', 0] } },
          },
        },
      ]),
      this.bookingModel.aggregate<BookingStatusBucket>([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ['$amount', 0] } },
          },
        },
      ]),
    ]);

    const escrowsByStatus: Record<string, number> = {};
    const escrowValueByStatus: Record<string, number> = {};
    let escrowValueHeld = 0;
    let escrowTotalVolume = 0;
    let escrowFeesCollected = 0;
    let sellerCommissionsCollected = 0;

    for (const bucket of escrowBuckets) {
      escrowsByStatus[bucket._id] = bucket.count;
      escrowValueByStatus[bucket._id] = bucket.value;
      escrowTotalVolume += bucket.value;

      // Money is still with the platform for both held and disputed transactions.
      if (
        bucket._id === TransactionStatus.HELD_IN_ESCROW ||
        bucket._id === TransactionStatus.DISPUTED
      ) {
        escrowValueHeld += bucket.value;
      }

      // A released trade is the only state in which the platform keeps its fees. A
      // refunded trade returns the escrow fee to the buyer, so it is not revenue.
      if (bucket._id === TransactionStatus.RELEASED) {
        escrowFeesCollected += bucket.escrowFees;
        sellerCommissionsCollected += bucket.sellerCommissions;
      }
    }

    const withdrawalsByStatus: Record<string, number> = {};
    const withdrawalValueByStatus: Record<string, number> = {};
    for (const bucket of withdrawalBuckets) {
      withdrawalsByStatus[bucket._id] = bucket.count;
      withdrawalValueByStatus[bucket._id] = bucket.value;
    }

    const bookingsByStatus: Record<string, number> = {};
    let bookingsTotalValue = 0;
    for (const bucket of bookingBuckets) {
      bookingsByStatus[bucket._id] = bucket.count;
      bookingsTotalValue += bucket.value;
    }

    return {
      users: {
        total: userTotal,
        verified: userVerified,
        suspended: userSuspended,
        admins: userAdmins,
      },
      providers: {
        total: userProviders,
      },
      items: {
        total: itemTotal,
        active: itemActive,
        inactive: itemInactive,
        promoted: itemPromoted,
        pending: itemPending,
        sold: itemSold,
        completed: itemCompleted,
      },
      services: {
        total: serviceTotal,
        active: serviceActive,
        remote: serviceRemote,
        inactive: serviceTotal - serviceActive,
      },
      bookings: {
        total: bookingBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
        pending: bookingsByStatus[BookingStatus.PENDING] || 0,
        confirmed: bookingsByStatus[BookingStatus.CONFIRMED] || 0,
        completed: bookingsByStatus[BookingStatus.COMPLETED] || 0,
        cancelled: bookingsByStatus[BookingStatus.CANCELLED] || 0,
        totalValue: bookingsTotalValue,
      },
      escrows: {
        total: escrowBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
        held: escrowsByStatus[TransactionStatus.HELD_IN_ESCROW] || 0,
        disputed: escrowsByStatus[TransactionStatus.DISPUTED] || 0,
        released: escrowsByStatus[TransactionStatus.RELEASED] || 0,
        refunded: escrowsByStatus[TransactionStatus.REFUNDED] || 0,
        valueHeld: escrowValueHeld,
        totalVolume: escrowTotalVolume,
        byStatus: escrowsByStatus,
        valueByStatus: escrowValueByStatus,
      },
      withdrawals: {
        pending: withdrawalsByStatus[WithdrawalStatus.PENDING] || 0,
        pendingValue: withdrawalValueByStatus[WithdrawalStatus.PENDING] || 0,
        processing: withdrawalsByStatus[WithdrawalStatus.PROCESSING] || 0,
        processingValue: withdrawalValueByStatus[WithdrawalStatus.PROCESSING] || 0,
        completed: withdrawalsByStatus[WithdrawalStatus.COMPLETED] || 0,
        failed: withdrawalsByStatus[WithdrawalStatus.FAILED] || 0,
      },
      revenue: {
        escrowFees: escrowFeesCollected,
        sellerCommissions: sellerCommissionsCollected,
        totalFees: escrowFeesCollected + sellerCommissionsCollected,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
