import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Offer, OfferStatus } from './schemas/offer.schema';
import { Item } from '../items/schemas/item.schema';
import { User } from '../users/schemas/user.schema';
import { CreateOfferDto } from './dto/create-offer.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OffersService {
  constructor(
    @InjectModel(Offer.name) private offerModel: Model<Offer>,
    @InjectModel(Item.name) private itemModel: Model<Item>,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createOffer(proposerId: string, dto: CreateOfferDto): Promise<Offer> {
    if (proposerId === dto.receiverId) {
      throw new BadRequestException('Cannot make an offer to yourself');
    }

    const targetItem = await this.itemModel.findById(dto.targetItemId);
    if (!targetItem) throw new NotFoundException('Target item not found');
    if (targetItem.sellerId.toString() !== dto.receiverId) {
      throw new BadRequestException('Receiver does not own the target item');
    }
    if (targetItem.status !== 'active') {
      throw new BadRequestException('Target item is no longer available');
    }

    const offeredItem = await this.itemModel.findById(dto.offeredItemId);
    if (!offeredItem) throw new NotFoundException('Offered item not found');
    if (offeredItem.sellerId.toString() !== proposerId) {
      throw new BadRequestException('You do not own the offered item');
    }
    if (offeredItem.status !== 'active') {
      throw new BadRequestException('Your offered item is not available');
    }

    // Prevent duplicate pending offers for the same items
    const existingOffer = await this.offerModel.findOne({
      proposerId,
      targetItemId: dto.targetItemId,
      status: { $in: [OfferStatus.PENDING, OfferStatus.ACCEPTED_BY_RECEIVER] }
    });
    if (existingOffer) {
      throw new BadRequestException('You already have a pending offer for this item');
    }

    const offer = new this.offerModel({
      ...dto,
      proposerId,
      status: OfferStatus.PENDING
    });
    const saved = await offer.save();

    // Dispatch notification to receiver
    try {
      const proposer = await this.userModel.findById(proposerId);
      await this.notificationsService.create({
        userId: dto.receiverId,
        actorId: proposerId,
        title: 'New Swap Offer Received! 🔄',
        message: `${proposer?.firstName || 'A trader'} sent you a swap offer for "${targetItem.title}".`,
        type: 'offer_received',
        link: '/dashboard/offers?tab=received',
        metadata: { offerId: saved._id.toString(), targetItemId: dto.targetItemId },
      });
    } catch (e) {
      // Non-blocking
    }

    return saved;
  }

  async getMyOffers(userId: string): Promise<Offer[]> {
    return this.offerModel.find({ proposerId: userId })
      .populate('targetItemId')
      .populate('offeredItemId')
      .populate('receiverId', 'firstName lastName avatarUrl')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getReceivedOffers(userId: string): Promise<Offer[]> {
    return this.offerModel.find({ receiverId: userId })
      .populate('targetItemId')
      .populate('offeredItemId')
      .populate('proposerId', 'firstName lastName avatarUrl')
      .sort({ createdAt: -1 })
      .exec();
  }

  async updateOfferStatus(
    offerId: string,
    userId: string,
    status: OfferStatus,
    extraData?: { receiverSwapDetails?: string; receiverHandoverNotes?: string },
  ): Promise<Offer> {
    const offer = await this.offerModel.findById(offerId);
    if (!offer) throw new NotFoundException('Offer not found');

    const isReceiver = offer.receiverId.toString() === userId;
    const isProposer = offer.proposerId.toString() === userId;

    if (!isReceiver && !isProposer) {
      throw new BadRequestException('You are not authorized to update this offer');
    }

    // Step 1: Receiver accepts swap and provides item details
    if (status === OfferStatus.ACCEPTED_BY_RECEIVER) {
      if (!isReceiver) {
        throw new BadRequestException('Only the receiver can accept the swap offer');
      }
      if (offer.status !== OfferStatus.PENDING && offer.status !== OfferStatus.COUNTERED) {
        throw new BadRequestException('Offer is no longer pending');
      }

      offer.status = OfferStatus.ACCEPTED_BY_RECEIVER;
      offer.receiverSwapDetails = extraData?.receiverSwapDetails || '';
      offer.receiverHandoverNotes = extraData?.receiverHandoverNotes || '';
      offer.receiverAcceptedAt = new Date();
      const saved = await offer.save();

      // Dispatch notification to the initiator to review and confirm
      try {
        const receiverUser = await this.userModel.findById(userId);
        const targetItem = await this.itemModel.findById(offer.targetItemId);
        await this.notificationsService.create({
          userId: offer.proposerId.toString(),
          actorId: userId,
          title: 'Swap Offer Accepted! Please Review & Confirm 🤝',
          message: `${receiverUser?.firstName || 'Item owner'} accepted your swap offer for "${targetItem?.title || 'item'}" and provided their item details. Please review and confirm before swapping occurs.`,
          type: 'swap_accepted',
          link: '/dashboard/offers?tab=sent',
          metadata: {
            offerId: offer._id.toString(),
            receiverSwapDetails: offer.receiverSwapDetails,
            receiverHandoverNotes: offer.receiverHandoverNotes,
          },
        });
      } catch (err) {
        // Non-blocking
      }

      return saved;
    }

    // Step 2: Final confirmation (by initiator after review, or direct acceptance)
    if (status === OfferStatus.ACCEPTED) {
      if (offer.status === OfferStatus.ACCEPTED_BY_RECEIVER) {
        if (!isProposer) {
          throw new BadRequestException('Only the initiator can confirm this swap request');
        }
      } else if (offer.status === OfferStatus.PENDING) {
        if (!isReceiver) {
          throw new BadRequestException('Only the receiver can accept this offer');
        }
      } else {
        throw new BadRequestException('Offer is not in an acceptable state');
      }

      const targetItem = await this.itemModel.findById(offer.targetItemId);
      const offeredItem = await this.itemModel.findById(offer.offeredItemId);

      if (targetItem?.status !== 'active' || offeredItem?.status !== 'active') {
        throw new BadRequestException('One or both items are no longer available for trade');
      }

      // Mark items as pending so they can't be traded again
      await this.itemModel.findByIdAndUpdate(offer.targetItemId, { status: 'pending' });
      await this.itemModel.findByIdAndUpdate(offer.offeredItemId, { status: 'pending' });

      // Automatically decline all other pending offers involving either of these items
      await this.offerModel.updateMany(
        {
          _id: { $ne: offer._id },
          status: { $in: [OfferStatus.PENDING, OfferStatus.ACCEPTED_BY_RECEIVER] },
          $or: [
            { targetItemId: offer.targetItemId },
            { offeredItemId: offer.targetItemId },
            { targetItemId: offer.offeredItemId },
            { offeredItemId: offer.offeredItemId },
          ],
        },
        { status: OfferStatus.DECLINED },
      );

      offer.status = OfferStatus.ACCEPTED;
      offer.initiatorConfirmedAt = new Date();
      const saved = await offer.save();

      // Dispatch notification to the other party
      try {
        const confirmingUser = await this.userModel.findById(userId);
        const notifyTargetUserId = isProposer ? offer.receiverId.toString() : offer.proposerId.toString();
        const targetItem = await this.itemModel.findById(offer.targetItemId);
        await this.notificationsService.create({
          userId: notifyTargetUserId,
          actorId: userId,
          title: 'Swap Confirmed! 🎉🤝',
          message: `${confirmingUser?.firstName || 'Trader'} confirmed the swap for "${targetItem?.title || 'item'}". The swap is now finalized! You can arrange item handover.`,
          type: 'swap_confirmed',
          link: isProposer ? '/dashboard/offers?tab=received' : '/dashboard/offers?tab=sent',
          metadata: { offerId: offer._id.toString() },
        });
      } catch (err) {
        // Non-blocking
      }

      return saved;
    }

    if (status === OfferStatus.DECLINED) {
      offer.status = OfferStatus.DECLINED;
      return offer.save();
    }

    offer.status = status;
    return offer.save();
  }
}
