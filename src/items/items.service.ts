import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Item, ItemStatus, ItemType } from './schemas/item.schema';
import { Transaction, TransactionStatus } from '../escrow/schemas/transaction.schema';
import { Offer, OfferStatus } from '../offers/schemas/offer.schema';
import { User } from '../users/schemas/user.schema';
import { Service } from '../services/schemas/service.schema';
import { NotificationsService } from '../notifications/notifications.service';

// Fields the owner may change on their own listing. sellerId/isPromoted are deliberately not
// here — those are platform-controlled.
const ITEM_UPDATABLE_FIELDS = [
  'title',
  'description',
  'price',
  'swapPreference',
  'type',
  'status',
  'location',
  'category',
  'images',
  'videos',
  'video360',
];

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    @InjectModel(Item.name) private itemModel: Model<Item>,
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
    @InjectModel(Offer.name) private offerModel: Model<Offer>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Service.name) private serviceModel: Model<Service>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(createItemDto: any, userId: string): Promise<Item> {
    const newItem = new this.itemModel({ ...createItemDto, sellerId: userId });
    return newItem.save();
  }

  async createDeclutterBatch(
    payload: {
      hostel?: string;
      groupName?: string;
      bundleDiscountPercent?: number;
      autoPriceDrop?: boolean;
      items: Array<{
        title: string;
        category?: string;
        price: number;
        description?: string;
        condition?: string;
        images?: string[];
        videos?: string[];
      }>;
    },
    userId: string,
  ) {
    if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new BadRequestException('At least one item is required for a room declutter batch');
    }

    const hostel = (payload.hostel || 'Campus Hostel').trim();
    const groupName = (payload.groupName || `${hostel} Declutter Sale`).trim();
    const bundleDiscount = Number(payload.bundleDiscountPercent || 0);
    const batchId = `BATCH_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const createdItems: Item[] = [];
    let totalValuation = 0;

    for (const item of payload.items) {
      const price = Number(item.price || 0);
      if (price <= 0 || Number.isNaN(price)) {
        throw new BadRequestException(`Invalid price for item "${item.title || 'Unknown'}". Price must be greater than 0.`);
      }
      totalValuation += price;

      const desc = [
        item.description || '',
        `📦 Part of "${groupName}" at ${hostel}.`,
        item.condition ? `Condition: ${item.condition}.` : '',
        bundleDiscount > 0 ? `🔥 Room Clearance: Get ${bundleDiscount}% off when taking room bundle!` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const newItem = new this.itemModel({
        title: item.title,
        description: desc,
        price,
        category: item.category || 'Appliances',
        type: ItemType.SELL,
        status: ItemStatus.ACTIVE,
        location: hostel,
        images: item.images && item.images.length ? item.images : ['https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&q=80&w=800'],
        videos: item.videos && item.videos.length ? item.videos : [],
        sellerId: userId,
        tags: ['declutter', 'room-clearance', 'hostel-moveout', hostel.toLowerCase().replace(/\s+/g, '-')],
        batchId,
        groupName,
        bundleDiscountPercent: bundleDiscount,
        autoPriceDrop: Boolean(payload.autoPriceDrop),
        condition: item.condition || 'Good Condition',
      });

      const saved = await newItem.save();
      createdItems.push(saved);
    }

    // Trigger Notifications & Emails in background
    void (async () => {
      try {
        const user = await this.userModel.findById(userId).select('firstName lastName email hostel').lean().exec();
        const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Student' : 'Student';

        // 1. Notify the seller
        await this.notificationsService.create({
          userId,
          title: `Room Declutter Batch Published! 📦`,
          message: `Your batch of ${createdItems.length} room items is live in ${hostel} with total valuation ₦${totalValuation.toLocaleString()}.`,
          type: 'declutter_listed' as any,
          link: `/explore?declutter=true`,
          metadata: { batchId, batchCount: createdItems.length, totalValuation, hostel },
        });

        if (user?.email) {
          await this.notificationsService.getEmailService().sendDeclutterSuccess(
            user.email,
            userName,
            createdItems.length,
            hostel,
            totalValuation,
          );
        }

        // 2. Aggressively notify other students in the same hostel
        const cleanHostelWord = hostel.split(/[, -]/)[0].trim();
        if (cleanHostelWord.length >= 3) {
          const hostelRegex = new RegExp(cleanHostelWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          const nearbyStudents = await this.userModel
            .find({
              hostel: hostelRegex,
              _id: { $ne: new Types.ObjectId(userId) },
            })
            .select('email firstName')
            .limit(30)
            .lean()
            .exec();

          // In-app notifications to all hostel students (0 token cost)
          for (const student of nearbyStudents) {
            await this.notificationsService.create({
              userId: student._id.toString(),
              title: `Hostel Declutter in ${hostel}! 📦`,
              message: `${userName} just published ${createdItems.length} room clearance items in ${hostel} (Total: ₦${totalValuation.toLocaleString()}).`,
              type: 'declutter_listed' as any,
              link: `/explore?declutter=true`,
              metadata: { batchId, hostel },
            });
          }

          // Email tokens management: send email alert to top 5 verified nearby students per batch
          const emailTargets = nearbyStudents.slice(0, 5);
          for (const student of emailTargets) {
            if (student.email) {
              await this.notificationsService.getEmailService().sendDeclutterHostelAlert(
                student.email,
                student.firstName || 'Student',
                hostel,
                createdItems.length,
                totalValuation,
              );
            }
          }
        }
      } catch (err: any) {
        this.logger.error(`Error in declutter background notifications: ${err?.message || err}`);
      }
    })();

    return {
      success: true,
      batchId,
      batchSize: createdItems.length,
      totalValuation,
      hostel,
      items: createdItems,
    };
  }

  /** Retrieve all items in a student's declutter batch */
  async findDeclutterBatch(batchId: string) {
    const items = await this.itemModel
      .find({ batchId, isActive: { $ne: false } })
      .populate('sellerId', 'firstName lastName hostel level rating isVerified avatar')
      .exec();

    if (!items || items.length === 0) {
      throw new NotFoundException('Declutter batch not found');
    }

    const totalValuation = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const activeItems = items.filter((item) => item.status === ItemStatus.ACTIVE);
    const bundleDiscountPercent = items[0]?.bundleDiscountPercent || 0;
    const discountedTotal = bundleDiscountPercent > 0
      ? Math.round(totalValuation * (1 - bundleDiscountPercent / 100))
      : totalValuation;

    return {
      batchId,
      seller: items[0]?.sellerId,
      hostel: items[0]?.location,
      totalItems: items.length,
      activeCount: activeItems.length,
      isFullySold: activeItems.length === 0,
      totalValuation,
      bundleDiscountPercent,
      discountedTotal,
      items,
    };
  }

  /** Catch Up Session Tracker: Fetch items and services listed since the user's last session */
  async getCatchUpListings(since?: string) {
    const cutoffDate = since && !Number.isNaN(Date.parse(since))
      ? new Date(since)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default to last 24 hours

    const [items, services] = await Promise.all([
      this.itemModel
        .find({
          status: ItemStatus.ACTIVE,
          isActive: { $ne: false },
          createdAt: { $gt: cutoffDate },
        })
        .populate('sellerId', 'firstName lastName hostel level rating isVerified avatar')
        .sort({ createdAt: -1 })
        .limit(30)
        .exec(),
      this.serviceModel
        .find({
          isActive: true,
          createdAt: { $gt: cutoffDate },
        })
        .populate('providerId', 'firstName lastName hostel rating avatar providerProfile')
        .sort({ createdAt: -1 })
        .limit(20)
        .exec(),
    ]);

    const buyCount = items.filter((i) => i.type === ItemType.SELL).length;
    const swapCount = items.filter((i) => i.type === ItemType.SWAP).length;

    return {
      since: cutoffDate.toISOString(),
      totalNewListings: items.length + services.length,
      itemsCount: items.length,
      servicesCount: services.length,
      breakdown: {
        buy: buyCount,
        swap: swapCount,
        services: services.length,
      },
      newItems: items,
      newServices: services,
      items,
      services,
    };
  }

  /** Instagram Reels Feed: high engagement media listings */
  async getReelsFeed(userId?: string, filter?: string) {
    const [items, services] = await Promise.all([
      this.itemModel
        .find({
          status: ItemStatus.ACTIVE,
          isActive: { $ne: false },
        })
        .populate('sellerId', 'firstName lastName hostel level rating isVerified avatar')
        .sort({ 'videos.0': -1, isPromoted: -1, likesCount: -1, createdAt: -1 })
        .limit(100)
        .lean()
        .exec(),
      this.serviceModel
        .find({ isActive: true })
        .populate('providerId', 'firstName lastName hostel rating avatar providerProfile')
        .sort({ totalBookings: -1, rating: -1, createdAt: -1 })
        .limit(40)
        .lean()
        .exec(),
    ]);

    const formattedItems = items.map((item: any) => ({
      ...item,
      isLiked: userId ? Boolean(item.likes?.includes(userId)) : false,
      likesCount: item.likesCount || item.likes?.length || 0,
      repostsCount: item.repostsCount || 0,
      commentsCount: item.comments?.length || 0,
      isService: false,
    }));

    const formattedServices = services.map((service: any) => ({
      _id: service._id,
      title: service.title,
      description: service.description,
      price: service.price,
      priceType: service.priceType,
      type: 'service',
      category: 'Campus Service',
      location: service.location || service.providerId?.hostel || 'Campus Wide',
      images: service.images || [],
      videos: service.videos || [],
      sellerId: service.providerId,
      isService: true,
      condition: 'Verified Service',
      likesCount: service.totalBookings ? service.totalBookings * 3 + 5 : 5,
      commentsCount: service.providerProfile?.totalReviews || 0,
      repostsCount: Math.floor((service.totalBookings || 1) / 2),
      isLiked: false,
      createdAt: service.createdAt,
    }));

    if (filter === 'items') return formattedItems;
    if (filter === 'services') return formattedServices;
    if (filter === 'declutter') return formattedItems.filter((i: any) => Boolean(i.batchId));

    // Combine all
    return [...formattedItems, ...formattedServices];
  }

  /** Like / Unlike a reel item */
  async toggleLike(itemId: string, userId: string) {
    if (!Types.ObjectId.isValid(itemId)) throw new NotFoundException('Item not found');
    const item = await this.itemModel.findById(itemId).exec();
    if (!item) throw new NotFoundException('Item not found');

    const likes = Array.isArray(item.likes) ? item.likes : [];
    const hasLiked = likes.includes(userId);

    let updated: Item;
    if (hasLiked) {
      updated = await this.itemModel.findByIdAndUpdate(
        itemId,
        {
          $pull: { likes: userId },
          $inc: { likesCount: -1 },
        },
        { new: true },
      ).exec();
    } else {
      updated = await this.itemModel.findByIdAndUpdate(
        itemId,
        {
          $addToSet: { likes: userId },
          $inc: { likesCount: 1 },
        },
        { new: true },
      ).exec();

      // Notify seller
      if (item.sellerId.toString() !== userId) {
        void (async () => {
          try {
            const user = await this.userModel.findById(userId).select('firstName lastName').lean().exec();
            const likerName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'A student';
            await this.notificationsService.create({
              userId: item.sellerId.toString(),
              actorId: userId,
              title: `❤️ New Reel Like!`,
              message: `${likerName} liked your listing "${item.title}".`,
              type: 'trade_requested' as any,
              link: `/item/${item._id}`,
            });
          } catch (e) {}
        })();
      }
    }

    return {
      liked: !hasLiked,
      likesCount: Math.max(0, updated?.likesCount || 0),
    };
  }

  /** Comment on a reel item */
  async addComment(itemId: string, userId: string, text: string) {
    if (!Types.ObjectId.isValid(itemId)) throw new NotFoundException('Item not found');
    const cleanText = (text || '').trim().slice(0, 500);
    if (!cleanText) throw new BadRequestException('Comment cannot be empty');

    const [item, user] = await Promise.all([
      this.itemModel.findById(itemId).exec(),
      this.userModel.findById(userId).select('firstName lastName avatar').lean().exec(),
    ]);

    if (!item) throw new NotFoundException('Item not found');

    const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Student' : 'Student';
    const comment = {
      userId,
      userName,
      userAvatar: user?.avatar || '',
      text: cleanText,
      createdAt: new Date(),
    };

    await this.itemModel.findByIdAndUpdate(
      itemId,
      { $push: { comments: comment } },
      { new: true },
    ).exec();

    // Notify seller
    if (item.sellerId.toString() !== userId) {
      void (async () => {
        try {
          await this.notificationsService.create({
            userId: item.sellerId.toString(),
            actorId: userId,
            title: `💬 New Reel Comment!`,
            message: `${userName} commented: "${cleanText.slice(0, 60)}" on "${item.title}".`,
            type: 'trade_requested' as any,
            link: `/item/${item._id}`,
          });
        } catch (e) {}
      })();
    }

    return comment;
  }

  /** Repost a reel item */
  async repostItem(itemId: string, userId: string) {
    if (!Types.ObjectId.isValid(itemId)) throw new NotFoundException('Item not found');
    const updated = await this.itemModel.findByIdAndUpdate(
      itemId,
      {
        $addToSet: { reposts: userId },
        $inc: { repostsCount: 1 },
      },
      { new: true },
    ).exec();

    if (!updated) throw new NotFoundException('Item not found');

    return {
      reposted: true,
      repostsCount: updated.repostsCount,
    };
  }

  async findAll(query: any): Promise<Item[]> {
    // A listing deactivated by an admin disappears from the public marketplace feed.
    const filter: any = { status: ItemStatus.ACTIVE, isActive: { $ne: false } };
    if (query.location) filter.location = new RegExp(String(query.location).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (query.type) filter.type = query.type;
    if (query.category) filter.category = query.category;
    if (query.tag) filter.tags = query.tag;
    if (query.declutter === 'true' || query.declutter === true) filter.tags = 'declutter';
    if (query.search || query.q) filter.$text = { $search: query.search || query.q };
    if (query.budget) filter.price = { $lte: Number(query.budget) };
    if (query.sellerId && query.sellerId !== 'undefined' && Types.ObjectId.isValid(query.sellerId)) {
      filter.sellerId = query.sellerId;
    }

    let dbQuery = this.itemModel.find(filter).populate('sellerId', 'firstName lastName hostel level rating isVerified avatar');
    
    if (query.sort === 'price_asc') {
      dbQuery = dbQuery.sort({ isPromoted: -1, price: 1 });
    } else if (query.sort === 'price_desc') {
      dbQuery = dbQuery.sort({ isPromoted: -1, price: -1 });
    } else if (query.search || query.q) {
      dbQuery = dbQuery.sort({ score: { $meta: 'textScore' }, isPromoted: -1, createdAt: -1 });
    } else {
      dbQuery = dbQuery.sort({ isPromoted: -1, createdAt: -1 });
    }

    return dbQuery.limit(50).exec();
  }

  async findOne(id: string): Promise<any> {
    if (id === 'reels') {
      return this.getReelsFeed();
    }
    if (id === 'catch-up') {
      return this.getCatchUpListings();
    }
    // `findById` throws a CastError (HTTP 500) on a non-ObjectId, so a typed URL
    // took the endpoint down instead of returning a clean 404. PATCH/DELETE in
    // this service already guarded; this was the odd one out.
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Item not found');
    const item = await this.itemModel.findById(id).populate('sellerId', 'firstName lastName hostel level rating isVerified avatar totalTrades').exec();
    if (!item) throw new NotFoundException('Item not found');
    // A listing deactivated by an admin is not servable to the public, even by direct id.
    if (item.isActive === false) throw new NotFoundException('Item not found');
    return item;
  }

  async findMyListings(userId: string): Promise<Item[]> {
    return this.itemModel.find({ sellerId: userId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * Admin marketplace list. Unlike the public feed this includes every status and
   * deactivated listings, so moderation can see and restore what it hid.
   */
  async findAllForAdmin(query: any = {}): Promise<Item[]> {
    const filter: any = {};

    if (query.status) {
      if (!Object.values(ItemStatus).includes(query.status)) {
        throw new BadRequestException(`Invalid status. Allowed: ${Object.values(ItemStatus).join(', ')}`);
      }
      filter.status = query.status;
    }
    if (query.type) {
      if (!Object.values(ItemType).includes(query.type)) {
        throw new BadRequestException(`Invalid type. Allowed: ${Object.values(ItemType).join(', ')}`);
      }
      filter.type = query.type;
    }
    if (query.isActive !== undefined) {
      filter.isActive = String(query.isActive) !== 'false';
    }
    if (query.search) {
      const search = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: search }, { description: search }, { location: search }];
    }

    const limit = Math.min(500, Math.max(1, Number(query.limit) || 200));

    return this.itemModel
      .find(filter)
      .populate('sellerId', 'firstName lastName email hostel avatar isVerified isActive')
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Admin moderation: status, visibility and promotion only. Owner-editable content
   * (price, title, images, sellerId) is intentionally not reachable here.
   */
  async moderate(id: string, data: any): Promise<Item> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Item not found');
    const item = await this.itemModel.findById(id).exec();
    if (!item) throw new NotFoundException('Item not found');

    const allowedFields = ['status', 'isActive', 'isFeatured', 'isPromoted'];
    const providedFields = Object.keys(data || {}).filter((key) => data[key] !== undefined);
    if (providedFields.length === 0) {
      throw new BadRequestException(`No changes provided. Allowed: ${allowedFields.join(', ')}`);
    }
    const unknownFields = providedFields.filter((field) => !allowedFields.includes(field));
    if (unknownFields.length > 0) {
      throw new BadRequestException(
        `These fields cannot be changed by an admin: ${unknownFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`,
      );
    }

    const update: any = {};

    if (data.status !== undefined) {
      if (!Object.values(ItemStatus).includes(data.status)) {
        throw new BadRequestException(`Invalid status. Allowed: ${Object.values(ItemStatus).join(', ')}`);
      }
      update.status = data.status;
    }

    if (data.isActive !== undefined) {
      if (typeof data.isActive !== 'boolean') {
        throw new BadRequestException('isActive must be a boolean');
      }
      update.isActive = data.isActive;
    }

    // `isFeatured` is the admin-facing name for the existing `isPromoted` column.
    let featured: boolean | undefined;
    if (data.isFeatured !== undefined) {
      if (typeof data.isFeatured !== 'boolean') {
        throw new BadRequestException('isFeatured must be a boolean');
      }
      featured = data.isFeatured;
    }
    if (data.isPromoted !== undefined) {
      if (typeof data.isPromoted !== 'boolean') {
        throw new BadRequestException('isPromoted must be a boolean');
      }
      if (featured !== undefined && featured !== data.isPromoted) {
        throw new BadRequestException('isFeatured and isPromoted contradict each other');
      }
      featured = data.isPromoted;
    }
    if (featured !== undefined) update.isPromoted = featured;

    return this.itemModel
      .findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .populate('sellerId', 'firstName lastName email hostel avatar isVerified isActive')
      .exec();
  }

  /** Owner-only edit of a listing. */
  async update(id: string, userId: string, data: any): Promise<Item> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Item not found');
    const item = await this.itemModel.findById(id).exec();
    if (!item) throw new NotFoundException('Item not found');
    this.assertOwner(item, userId);

    const safeUpdate: any = {};
    for (const field of ITEM_UPDATABLE_FIELDS) {
      if (data && data[field] !== undefined) safeUpdate[field] = data[field];
    }
    if (Object.keys(safeUpdate).length === 0) {
      throw new BadRequestException(`No updatable fields provided. Allowed: ${ITEM_UPDATABLE_FIELDS.join(', ')}`);
    }

    if (safeUpdate.type !== undefined && !Object.values(ItemType).includes(safeUpdate.type)) {
      throw new BadRequestException(`Invalid type. Allowed: ${Object.values(ItemType).join(', ')}`);
    }
    if (safeUpdate.status !== undefined && !Object.values(ItemStatus).includes(safeUpdate.status)) {
      throw new BadRequestException(`Invalid status. Allowed: ${Object.values(ItemStatus).join(', ')}`);
    }
    if (safeUpdate.price !== undefined) {
      const price = Number(safeUpdate.price);
      if (Number.isNaN(price) || price < 0) throw new BadRequestException('price must be a positive number');
      safeUpdate.price = price;
    }

    return this.itemModel.findByIdAndUpdate(id, safeUpdate, { new: true }).exec();
  }

  /** Owner-only delete. Refuses to orphan a trade that is currently in flight. */
  async remove(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Item not found');
    const item = await this.itemModel.findById(id).exec();
    if (!item) throw new NotFoundException('Item not found');
    this.assertOwner(item, userId);

    return this.deleteListing(item);
  }

  /**
   * Admin delete: same trade-safety rules as the owner path, but no ownership test.
   * An admin cannot delete a listing that still has money held against it.
   */
  async removeAsAdmin(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Item not found');
    const item = await this.itemModel.findById(id).exec();
    if (!item) throw new NotFoundException('Item not found');

    return this.deleteListing(item);
  }

  private async deleteListing(item: Item) {
    const id = item._id.toString();

    // Money is held for this item, so the trade must be resolved before the listing disappears.
    const activeEscrow = await this.txModel.exists({
      itemId: id,
      status: { $in: [TransactionStatus.HELD_IN_ESCROW, TransactionStatus.DISPUTED] },
    });
    if (activeEscrow) {
      throw new BadRequestException('This item is part of an active escrow trade and cannot be deleted. Release or dispute the transaction first.');
    }

    // offers.service marks both items as pending once an offer is accepted.
    if (item.status === ItemStatus.PENDING) {
      throw new BadRequestException('This item is part of an accepted trade and cannot be deleted.');
    }

    // Any other pending offers would point at a listing that no longer exists.
    const declined = await this.offerModel.updateMany(
      { status: OfferStatus.PENDING, $or: [{ targetItemId: id }, { offeredItemId: id }] },
      { status: OfferStatus.DECLINED },
    ).exec();

    await this.itemModel.findByIdAndDelete(id).exec();

    return {
      success: true,
      deleted: true,
      itemId: id,
      declinedOffers: declined.modifiedCount || 0,
    };
  }

  private assertOwner(item: Item, userId: string): void {
    if (item.sellerId?.toString() !== userId) {
      throw new ForbiddenException('You can only manage your own listing');
    }
  }
}
