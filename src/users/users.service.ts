import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User, RECENTLY_VIEWED_LIMIT } from './schemas/user.schema';
import { Item, ItemStatus } from '../items/schemas/item.schema';
import { Transaction, TransactionStatus } from '../escrow/schemas/transaction.schema';
import { Offer } from '../offers/schemas/offer.schema';
import { Chat } from '../chat/schemas/chat.schema';
import { Message } from '../chat/schemas/message.schema';
import { Withdrawal, WithdrawalStatus } from '../withdrawals/schemas/withdrawal.schema';
import { PaystackService } from '../payments/paystack.service';

// Payouts below this are not worth the Paystack fee/risk of a failed bank transfer.
export const MIN_WITHDRAWAL_AMOUNT = 1000;

// Fields a user is allowed to change about themselves. Everything else (walletBalance,
// isVerified, email, password, ...) is intentionally not settable through the profile route.
const PROFILE_UPDATABLE_FIELDS = [
  'firstName',
  'lastName',
  'whatsappNumber',
  'university',
  'hostel',
  'level',
  'avatar',
];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Item.name) private itemModel: Model<Item>,
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    @InjectModel(Offer.name) private offerModel: Model<Offer>,
    @InjectModel(Chat.name) private chatModel: Model<Chat>,
    @InjectModel(Message.name) private messageModel: Model<Message>,
    @InjectModel(Withdrawal.name) private withdrawalModel: Model<Withdrawal>,
    private readonly paystackService: PaystackService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).select('+password').exec();
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().exec();
  }

  /** Admin user list. Device tokens and password-reset hashes never leave the admin API. */
  async findAllForAdmin(): Promise<User[]> {
    return this.userModel
      .find()
      .select('-fcmToken -passwordResetTokenHash -passwordResetExpires')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Everything an admin needs in the user-detail panel: the account (including wallet),
   * the listings it owns, both sides of its escrow history and its withdrawals.
   */
  async getAdminUserDetail(userId: string) {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('User not found');

    const user = await this.userModel
      .findById(userId)
      .select('-fcmToken -passwordResetTokenHash -passwordResetExpires')
      .exec();
    if (!user) throw new NotFoundException('User not found');

    const id = user._id.toString();
    const [items, escrows, withdrawals, itemCount, escrowCount, activeEscrowCount] =
      await Promise.all([
        this.itemModel.find({ sellerId: user._id }).sort({ createdAt: -1 }).limit(100).exec(),
        this.transactionModel
          .find({ $or: [{ buyerId: id }, { sellerId: id }] })
          .sort({ createdAt: -1 })
          .limit(100)
          .exec(),
        this.withdrawalModel.find({ userId: id }).sort({ createdAt: -1 }).limit(50).exec(),
        this.itemModel.countDocuments({ sellerId: user._id }),
        this.transactionModel.countDocuments({ $or: [{ buyerId: id }, { sellerId: id }] }),
        this.transactionModel.countDocuments({
          $or: [{ buyerId: id }, { sellerId: id }],
          status: { $in: [TransactionStatus.HELD_IN_ESCROW, TransactionStatus.DISPUTED] },
        }),
      ]);

    return {
      user,
      items,
      escrows,
      withdrawals,
      counts: {
        items: itemCount,
        escrows: escrowCount,
        activeEscrows: activeEscrowCount,
        walletBalance: Number(user.walletBalance || 0),
      },
    };
  }

  /**
   * Admin-only account flags. The whitelist is deliberately tiny: `isVerified`,
   * `isActive`, `isAdmin` and the `suspended` alias for `!isActive`. Profile fields,
   * passwords, wallet balances and email are rejected rather than silently ignored.
   */
  async adminUpdateUser(userId: string, patch: any): Promise<User> {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('User not found');
    if (!patch || typeof patch !== 'object') {
      throw new BadRequestException('A JSON body is required');
    }

    const allowedFields = ['isVerified', 'isActive', 'isAdmin', 'suspended'];
    const providedFields = Object.keys(patch).filter((key) => patch[key] !== undefined);
    if (providedFields.length === 0) {
      throw new BadRequestException(
        `No changes provided. Allowed: ${allowedFields.filter((field) => field !== 'suspended').join(', ')}, suspended`,
      );
    }

    const unknownFields = providedFields.filter((field) => !allowedFields.includes(field));
    if (unknownFields.length > 0) {
      throw new BadRequestException(
        `These fields cannot be changed by an admin: ${unknownFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`,
      );
    }

    const update: any = {};
    for (const flag of ['isVerified', 'isActive', 'isAdmin']) {
      if (patch[flag] === undefined) continue;
      if (typeof patch[flag] !== 'boolean') {
        throw new BadRequestException(`${flag} must be a boolean`);
      }
      update[flag] = patch[flag];
    }

    if (patch.suspended !== undefined) {
      if (typeof patch.suspended !== 'boolean') {
        throw new BadRequestException('suspended must be a boolean');
      }
      const active = !patch.suspended;
      if (update.isActive !== undefined && update.isActive !== active) {
        throw new BadRequestException('isActive and suspended contradict each other');
      }
      update.isActive = active;
    }

    if (Object.keys(update).length === 0) {
      throw new BadRequestException('No changes provided');
    }

    const updated = await this.userModel
      .findByIdAndUpdate(userId, update, { new: true, runValidators: true })
      .select('-fcmToken -passwordResetTokenHash -passwordResetExpires')
      .exec();
    if (!updated) throw new NotFoundException('User not found');

    return updated;
  }

  async create(data: Partial<User>): Promise<User> {
    return new this.userModel(data).save();
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const safeUpdate: any = {};
    for (const field of PROFILE_UPDATABLE_FIELDS) {
      if (data && (data as any)[field] !== undefined) safeUpdate[field] = (data as any)[field];
    }
    return this.userModel.findByIdAndUpdate(id, safeUpdate, { new: true }).exec();
  }

  /**
   * Stores the device push token. An empty/blank token is ignored rather than clearing the
   * stored one, so a client that fails to obtain a token cannot wipe push delivery.
   */
  async updateFcmToken(userId: string, token?: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const cleanToken = typeof token === 'string' ? token.trim() : '';
    if (!cleanToken) {
      return { success: true, updated: false, fcmToken: user.fcmToken || null, message: 'Empty token ignored' };
    }

    user.fcmToken = cleanToken;
    await user.save();
    return { success: true, updated: true, fcmToken: cleanToken };
  }

  /** Recently viewed items, most recent first. */
  async getRecentlyViewed(userId: string): Promise<Item[]> {
    const user = await this.userModel.findById(userId).populate({
      path: 'recentlyViewed',
      select: 'title description price type status location category images videos swapPreference isPromoted sellerId',
      populate: { path: 'sellerId', select: 'firstName lastName hostel avatar isVerified rating' },
    }).exec();
    if (!user) throw new NotFoundException('User not found');

    // Items deleted since they were viewed populate as null; drop them for the caller.
    return ((user.recentlyViewed || []) as any[]).filter(Boolean) as Item[];
  }

  /**
   * Records a viewed item at the head of the list, de-duplicated and capped so the array
   * cannot grow without bound.
   */
  async addRecentlyViewed(userId: string, itemId: string): Promise<Item[]> {
    if (!Types.ObjectId.isValid(itemId)) throw new BadRequestException('Invalid itemId');
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const item = await this.itemModel.findById(itemId).exec();
    if (!item) throw new NotFoundException('Item not found');

    // $pull and $push target the same path, so they cannot be combined in one update.
    await this.userModel.findByIdAndUpdate(userId, { $pull: { recentlyViewed: item._id } }).exec();
    await this.userModel.findByIdAndUpdate(userId, {
      $push: { recentlyViewed: { $each: [item._id], $position: 0, $slice: RECENTLY_VIEWED_LIMIT } },
    }).exec();

    return this.getRecentlyViewed(userId);
  }

  /**
   * Hard-deletes the account and its owned marketplace data. Blocked while the user still has
   * money or goods in flight, and escrow transactions themselves are always retained as
   * financial records.
   */
  async deleteAccount(userId: string, reason?: string) {
    // findById throws a CastError (HTTP 500) on a malformed id; the admin delete route
    // must answer 404 instead.
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('User not found');
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Refuse to delete while funds or an accepted trade are in flight.
    const activeEscrow = await this.transactionModel.countDocuments({
      $or: [{ buyerId: userId }, { sellerId: userId }],
      status: TransactionStatus.HELD_IN_ESCROW,
    });
    const itemsInTrade = await this.itemModel.countDocuments({
      sellerId: userId,
      status: ItemStatus.PENDING,
    });
    if (activeEscrow > 0 || itemsInTrade > 0) {
      throw new BadRequestException(
        `Account cannot be deleted while ${activeEscrow} escrow transaction(s) and ${itemsInTrade} item(s) are still in an active trade. Complete or cancel them first.`,
      );
    }

    const listings = await this.itemModel.find({ sellerId: userId }).select('_id').lean().exec();
    const listingIds = listings.map((item) => item._id);

    const deletedListings = listingIds.length
      ? (await this.itemModel.deleteMany({ _id: { $in: listingIds } })).deletedCount
      : 0;

    // Offers are meaningless once the account or its listings are gone.
    await this.offerModel.deleteMany({
      $or: [
        { proposerId: userId },
        { receiverId: userId },
        { targetItemId: { $in: listingIds } },
        { offeredItemId: { $in: listingIds } },
      ],
    }).exec();

    // Only remove the user from chats; a chat that still has another participant keeps its
    // history for that person.
    const chats = await this.chatModel.find({ participants: userId }).select('participants').lean().exec();
    let deletedChats = 0;
    for (const chat of chats) {
      const remaining = (chat.participants || []).filter((participant) => participant.toString() !== userId);
      if (remaining.length === 0) {
        deletedChats++;
        await this.chatModel.findByIdAndDelete(chat._id).exec();
        await this.messageModel.deleteMany({ chatId: chat._id }).exec();
      } else {
        await this.chatModel.findByIdAndUpdate(chat._id, { participants: remaining }).exec();
      }
    }

    // Transactions stay behind as the financial/audit trail for the escrow ledger.
    const retainedTransactions = await this.transactionModel.countDocuments({
      $or: [{ buyerId: userId }, { sellerId: userId }],
    });

    await this.userModel.findByIdAndDelete(userId).exec();

    this.logger.log(
      `Hard-deleted account ${user.email} (${userId}): ${deletedListings} listing(s), ${deletedChats} chat(s); ` +
        `${retainedTransactions} transaction(s) retained for the ledger. Reason: ${reason || 'not provided'}`,
    );

    return {
      success: true,
      deleted: true,
      deletionType: 'hard',
      userId,
      deletedListings,
      deletedChats,
      retainedTransactions,
      reason: reason || null,
      deletedAt: new Date().toISOString(),
    };
  }

  async incrementWalletBalance(id: string, amount: number): Promise<User> {
    return this.userModel.findByIdAndUpdate(id, { $inc: { walletBalance: amount } }, { new: true }).exec();
  }

  /**
   * Issues a password reset token. The plain token is returned to the caller so it can be
   * emailed; only its SHA-256 hash is persisted, together with a one-hour expiry.
   */
  async createPasswordResetToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await this.userModel
      .findByIdAndUpdate(userId, {
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
      })
      .exec();

    return token;
  }

  /**
   * Consumes a password reset token. Returns false when the token is unknown, already used
   * or expired — the caller must treat that as an invalid reset, not as success.
   */
  async resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
    const cleanToken = typeof token === 'string' ? token.trim() : '';
    if (!cleanToken) return false;

    const tokenHash = createHash('sha256').update(cleanToken).digest('hex');
    const user = await this.userModel
      .findOne({
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: { $gt: new Date() },
      })
      .select('_id')
      .exec();

    if (!user) return false;

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.userModel
      .updateOne(
        { _id: user._id },
        {
          $set: { password: hashed },
          $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 },
        },
      )
      .exec();

    return true;
  }

  /** Saved payout bank account, or null when the user has not added one yet. */
  async getBankDetails(userId: string) {
    const user = await this.userModel.findById(userId).select('bankDetails').exec();
    if (!user) throw new NotFoundException('User not found');
    return user.bankDetails || null;
  }

  /**
   * Saves the payout bank account. The account name is resolved against Paystack first, so an
   * unverified account number is never persisted; the returned name is what gets stored.
   */
  async updateBankDetails(
    userId: string,
    input: { bankCode?: string | number; bankName?: string; accountNumber?: string },
  ) {
    const bankCode =
      input?.bankCode === undefined || input?.bankCode === null
        ? ''
        : String(input.bankCode).trim();
    const accountNumber =
      typeof input?.accountNumber === 'string' ? input.accountNumber.trim() : '';

    if (!bankCode) throw new BadRequestException('bankCode is required');
    if (!accountNumber) throw new BadRequestException('accountNumber is required');
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new BadRequestException('accountNumber must be a 10-digit NUBAN account number');
    }

    const user = await this.userModel.findById(userId).select('_id').exec();
    if (!user) throw new NotFoundException('User not found');

    const banks = await this.paystackService.listBanks();
    const bank = banks.find((candidate) => candidate.code === bankCode);
    if (!bank) {
      throw new BadRequestException(
        `Unknown bank code "${bankCode}". Fetch the bank list from GET /banks and retry.`,
      );
    }

    const resolved = await this.paystackService.resolveAccount(accountNumber, bankCode);
    const bankName =
      (typeof input?.bankName === 'string' ? input.bankName.trim() : '') || bank.name;

    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        { bankDetails: { bankCode, bankName, accountNumber, accountName: resolved.accountName } },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('User not found');

    return updated.bankDetails;
  }

  /**
   * Withdraws wallet funds to the user's bank account through Paystack.
   *
   * The debit is a single guarded `findOneAndUpdate` (`walletBalance >= amount`), which is
   * what makes concurrent withdrawals safe: only one update can match and win. The Withdrawal
   * row is written first as an audit trail; if anything fails after the debit and before
   * Paystack accepts the transfer, the wallet is refunded and the row is marked failed.
   * Success is only returned once Paystack has actually created the transfer.
   */
  async withdraw(userId: string, amount: number): Promise<Withdrawal> {
    const requested = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new BadRequestException('Withdrawal amount must be a positive number');
    }

    // Naira has two decimal places; normalise before validating or charging anything.
    const withdrawalAmount = Math.round(requested * 100) / 100;
    if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
      throw new BadRequestException('Withdrawal amount must be a positive number');
    }
    if (withdrawalAmount < MIN_WITHDRAWAL_AMOUNT) {
      throw new BadRequestException(
        `Minimum withdrawal amount is ₦${MIN_WITHDRAWAL_AMOUNT.toLocaleString('en-NG')}`,
      );
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    if (withdrawalAmount > Number(user.walletBalance || 0)) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const bank = user.bankDetails;
    if (!bank?.bankCode || !bank?.accountNumber || !bank?.accountName) {
      throw new BadRequestException(
        'Add your bank account details before withdrawing (PUT /users/me/bank-details).',
      );
    }

    const reference = `WD-${randomBytes(4).toString('hex').toUpperCase()}`;
    const withdrawal = await this.withdrawalModel.create({
      userId: String(user._id),
      amount: withdrawalAmount,
      fee: 0,
      netAmount: withdrawalAmount,
      reference,
      status: WithdrawalStatus.PENDING,
      bankCode: bank.bankCode,
      bankName: bank.bankName || bank.bankCode,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
    });

    // Atomic debit: the balance guard lives in the query, so two simultaneous withdrawals can
    // never both match. The loser is recorded as a failed attempt and told the balance changed.
    const debitedUser = await this.userModel
      .findOneAndUpdate(
        { _id: user._id, walletBalance: { $gte: withdrawalAmount } },
        { $inc: { walletBalance: -withdrawalAmount } },
        { new: true },
      )
      .exec();

    if (!debitedUser) {
      await this.withdrawalModel
        .findByIdAndUpdate(withdrawal._id, {
          status: WithdrawalStatus.FAILED,
          failureReason: 'Insufficient wallet balance',
        })
        .exec();
      throw new BadRequestException('Insufficient wallet balance');
    }

    let transferInitiated = false;

    try {
      const recipient = await this.paystackService.createTransferRecipient({
        name: bank.accountName,
        accountNumber: bank.accountNumber,
        bankCode: bank.bankCode,
      });

      // Keep the recipient code on the audit row before the transfer call.
      await this.withdrawalModel
        .findByIdAndUpdate(withdrawal._id, { paystackRecipientCode: recipient.recipientCode })
        .exec();

      const transfer = await this.paystackService.initiateTransfer({
        amount: withdrawalAmount,
        reference: withdrawal.reference,
        recipient: recipient.recipientCode,
        reason: `Barter wallet withdrawal ${withdrawal.reference}`,
      });

      // A 2xx can still describe an immediately failed transfer; treat that as no payout.
      if (transfer.status === 'failed') {
        throw new InternalServerErrorException(
          `Paystack reported the transfer as failed (${transfer.transferCode}). No payout was made.`,
        );
      }

      transferInitiated = true;

      if (transfer.status === 'otp') {
        this.logger.warn(
          `Paystack transfer ${transfer.transferCode} (${withdrawal.reference}) is awaiting OTP confirmation in the Paystack dashboard.`,
        );
      }

      const completed = await this.withdrawalModel
        .findByIdAndUpdate(
          withdrawal._id,
          {
            status: WithdrawalStatus.PROCESSING,
            paystackRecipientCode: recipient.recipientCode,
            transferCode: transfer.transferCode,
          },
          { new: true },
        )
        .exec();

      if (!completed) {
        this.logger.error(
          `Withdrawal ${withdrawal.reference}: Paystack transfer ${transfer.transferCode} was initiated but the audit row could not be updated.`,
        );
        throw new InternalServerErrorException(
          `The payout was initiated (transfer ${transfer.transferCode}) but the withdrawal record could not be updated. Contact support with reference ${withdrawal.reference}.`,
        );
      }

      this.logger.log(
        `Withdrawal ${withdrawal.reference}: paid ₦${withdrawalAmount} to ${bank.accountName} via Paystack transfer ${transfer.transferCode}`,
      );
      return completed;
    } catch (error) {
      // Once Paystack has accepted a transfer the money is in flight. Refunding locally at
      // that point would pay the user twice, so only pre-transfer failures are refunded.
      if (transferInitiated) throw error;

      await this.failAndRefundWithdrawal(withdrawal, error);
      throw error;
    }
  }

  /** The caller's withdrawal history, newest first. */
  async getWithdrawals(userId: string): Promise<Withdrawal[]> {
    return this.withdrawalModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * Marks a debited withdrawal as failed and returns the money to the wallet. Only called
   * while Paystack has NOT accepted a transfer.
   */
  private async failAndRefundWithdrawal(withdrawal: Withdrawal, error: unknown): Promise<void> {
    const reason =
      error instanceof Error && error.message ? error.message : 'The withdrawal failed';
    const storedReason = reason.slice(0, 500);

    try {
      await this.withdrawalModel
        .findByIdAndUpdate(withdrawal._id, {
          status: WithdrawalStatus.FAILED,
          failureReason: storedReason,
        })
        .exec();
    } catch (updateError) {
      this.logger.error(
        `Withdrawal ${withdrawal.reference}: could not be marked as failed (${updateError.message}).`,
      );
    }

    let refunded = false;
    try {
      await this.userModel
        .updateOne({ _id: withdrawal.userId }, { $inc: { walletBalance: withdrawal.amount } })
        .exec();
      refunded = true;
    } catch (refundError) {
      this.logger.error(
        `CRITICAL: withdrawal ${withdrawal.reference} failed after debiting ₦${withdrawal.amount}, ` +
          `and the refund to user ${withdrawal.userId} also failed (${refundError.message}). Manual reconciliation required.`,
      );
    }

    if (refunded) {
      this.logger.warn(
        `Withdrawal ${withdrawal.reference} failed and ₦${withdrawal.amount} was refunded to user ${withdrawal.userId}: ${storedReason}`,
      );
    }
  }

  async getMyStats(userId: string) {
    const activeListings = await this.itemModel.countDocuments({
      sellerId: userId,
      status: ItemStatus.ACTIVE,
    });

    const completedTrades = await this.transactionModel.countDocuments({
      $or: [{ buyerId: userId }, { sellerId: userId }],
      status: TransactionStatus.RELEASED,
    });

    const escrowTransactions = await this.transactionModel.find({
      sellerId: userId,
      status: TransactionStatus.HELD_IN_ESCROW,
    });

    const escrowBalance = escrowTransactions.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const user = await this.userModel.findById(userId);
    // `rating` is the real field maintained on the user document. It starts at 0 and is
    // only ever set by actual trade feedback; there is no invented fallback rating.
    const sellerRating = Number(user?.rating ?? 0);

    return {
      activeListings,
      completedTrades,
      escrowBalance,
      walletBalance: user?.walletBalance || 0,
      sellerRating,
    };
  }

  async findOrCreateGoogle(profile: any): Promise<User> {
    let user = await this.userModel.findOne({ googleId: profile.id }).exec();
    if (!user) {
      user = await this.userModel.findOne({ email: profile.emails[0].value }).exec();
      if (user) {
        user.googleId = profile.id;
        user.avatar = profile.photos?.[0]?.value;
        await user.save();
      } else {
        user = await new this.userModel({
          googleId: profile.id,
          email: profile.emails[0].value,
          firstName: profile.name?.givenName || 'User',
          lastName: profile.name?.familyName || '',
          avatar: profile.photos?.[0]?.value,
          isVerified: true,
        }).save();
      }
    }
    return user;
  }
}
