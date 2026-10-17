import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { Item, ItemStatus } from '../items/schemas/item.schema';
import { Transaction, TransactionStatus } from '../escrow/schemas/transaction.schema';
import { Withdrawal, WithdrawalStatus } from '../withdrawals/schemas/withdrawal.schema';

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

/**
 * Platform counters for the admin dashboard.
 *
 * Every number is a real aggregation over the collections this API owns — there are no
 * defaults or sample values. `bookings` is intentionally absent: the bookings module is
 * owned by a separate workstream and is not registered in AppModule yet.
 */
@Injectable()
export class AdminStatsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Item.name) private readonly itemModel: Model<Item>,
    @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
  ) {}

  async getStats() {
    const [
      userTotal,
      userVerified,
      userSuspended,
      userAdmins,
      itemTotal,
      itemActive,
      itemInactive,
      itemPromoted,
      itemPending,
      itemSold,
      itemCompleted,
      escrowBuckets,
      withdrawalBuckets,
    ] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({ isVerified: true }),
      this.userModel.countDocuments({ isActive: false }),
      this.userModel.countDocuments({ isAdmin: true }),
      this.itemModel.countDocuments(),
      this.itemModel.countDocuments({ status: ItemStatus.ACTIVE, isActive: { $ne: false } }),
      this.itemModel.countDocuments({ isActive: false }),
      this.itemModel.countDocuments({ isPromoted: true }),
      this.itemModel.countDocuments({ status: ItemStatus.PENDING }),
      this.itemModel.countDocuments({ status: ItemStatus.SOLD }),
      this.itemModel.countDocuments({ status: ItemStatus.COMPLETED }),
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

    return {
      users: {
        total: userTotal,
        verified: userVerified,
        suspended: userSuspended,
        admins: userAdmins,
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
