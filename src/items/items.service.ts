import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Item, ItemStatus, ItemType } from './schemas/item.schema';
import { Transaction, TransactionStatus } from '../escrow/schemas/transaction.schema';
import { Offer, OfferStatus } from '../offers/schemas/offer.schema';

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
];

@Injectable()
export class ItemsService {
  constructor(
    @InjectModel(Item.name) private itemModel: Model<Item>,
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
    @InjectModel(Offer.name) private offerModel: Model<Offer>,
  ) {}

  async create(createItemDto: any, userId: string): Promise<Item> {
    const newItem = new this.itemModel({ ...createItemDto, sellerId: userId });
    return newItem.save();
  }

  async findAll(query: any): Promise<Item[]> {
    // A listing deactivated by an admin disappears from the public marketplace feed.
    const filter: any = { status: ItemStatus.ACTIVE, isActive: { $ne: false } };
    if (query.location) filter.location = query.location;
    if (query.type) filter.type = query.type;
    if (query.category) filter.category = query.category;
    if (query.search || query.q) filter.$text = { $search: query.search || query.q };
    if (query.budget) filter.price = { $lte: Number(query.budget) };

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

  async findOne(id: string): Promise<Item> {
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
