import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setting } from '../settings/schemas/setting.schema';

export interface EscrowWhatsAppTemplateData {
  sellerName?: string;
  buyerName?: string;
  itemTitle: string;
  amount: number;
  txId?: string;
}

export interface BookingWhatsAppTemplateData {
  providerName?: string;
  clientName?: string;
  serviceTitle: string;
  bookingDate?: string;
  timeSlot?: string;
  amount?: number;
}

export interface OfferWhatsAppTemplateData {
  receiverName?: string;
  proposerName?: string;
  targetItemTitle: string;
  offeredItemTitle?: string;
  cashDifference?: number;
  cashTopUp?: number;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private static readonly DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━';
  private readonly groupParticipantCache = new Map<string, { fetchedAt: number; map: Map<string, string> }>();
  private readonly recentlyPromptedNumbers = new Map<string, number>();

  constructor(
    private readonly configService: ConfigService,
    // Resolved at call time: ItemsModule already imports this module, so a static dependency would cycle.
    private readonly moduleRef: ModuleRef,
    @InjectModel(Setting.name) private readonly settingModel: Model<any>,
  ) {}

  /**
   * Format phone number to E.164 standard (e.g., +2348012345678)
   */
  formatPhoneNumber(phone: string): string {
    if (!phone) return '';
    let cleaned = phone.replace(/[^0-9+]/g, '');

    // Nigerian local format (e.g. 08012345678 -> +2348012345678)
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      cleaned = '+234' + cleaned.substring(1);
    } else if (cleaned.startsWith('234') && !cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    } else if (!cleaned.startsWith('+')) {
      cleaned = '+234' + cleaned;
    }
    return cleaned;
  }

  /**
   * Resolve customer support WhatsApp numbers from environment
   */
  getSupportPhones(): string[] {
    const raw = this.configService.get<string>('CUSTOMER_SERVICE_WHATSAPP');
    if (!raw) return [];
    return raw
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 5);
  }

  /**
   * Primary sender via Evolution API
   */
  async sendWhatsApp(phone: string, text: string, options?: { mentioned?: string[] }): Promise<boolean> {
    if (!phone || !text) return false;

    const isGroup = phone.includes('@g.us');
    const targetNumber = isGroup ? phone.trim() : this.formatPhoneNumber(phone).replace(/\D/g, '');

    const evoUrl = this.configService.get<string>('WHATSAPP_EVOLUTION_API_URL')?.replace(/\/$/, '');
    const evoKey = this.configService.get<string>('WHATSAPP_EVOLUTION_API_KEY');
    const evoInstance = this.configService.get<string>('WHATSAPP_EVOLUTION_INSTANCE') || 'Erranders';

    try {
      if (!evoUrl || !evoKey) {
        this.logger.warn('WHATSAPP_EVOLUTION_API_URL or WHATSAPP_EVOLUTION_API_KEY is not configured');
        return false;
      }

      const payload: any = {
        number: targetNumber,
        text,
      };

      if (options?.mentioned?.length) {
        payload.mentioned = options.mentioned;
      }

      const response = await fetch(`${evoUrl}/message/sendText/${evoInstance}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: evoKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      const data = (await response.json().catch(() => ({}))) as any;
      if (!response.ok) {
        throw new Error(data?.message || data?.error || `Evolution API ${response.status}`);
      }

      const msgId = data?.key?.id || data?.id || 'ok';
      this.logger.log(`✅ WhatsApp sent to ${targetNumber}. Message ID: ${msgId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`❌ WhatsApp Failed to ${phone}: ${error.message}`);
      return false;
    }
  }

  // ─── Templates for Barter ──────────────────────────────────────────────────

  /**
   * 1. Escrow Payment Received (Sent to Seller)
   */
  async notifySellerEscrowInitiated(sellerPhone: string, data: EscrowWhatsAppTemplateData): Promise<boolean> {
    const seller = data.sellerName || 'Student';
    const buyer = data.buyerName || 'A student buyer';
    const amount = (data.amount || 0).toLocaleString();

    const message = `🛍️ *ERRANDERS BARTER: ESCROW PAYMENT RECEIVED*
${WhatsAppService.DIVIDER}
👋 Hi *${seller}*, good news!

*${buyer}* has paid *₦${amount}* into secure escrow for your item:
📦 *"${data.itemTitle}"*

⚡ *Next Steps:*
1. Reach out to the buyer on campus to arrange handover or delivery.
2. Once the buyer inspects and confirms receipt, funds are released immediately to your wallet.

💬 Need assistance? Reply directly to this WhatsApp message.`;

    return this.sendWhatsApp(sellerPhone, message);
  }

  /**
   * 2. Escrow Payment Confirmed (Sent to Buyer)
   */
  async notifyBuyerEscrowPayment(buyerPhone: string, data: EscrowWhatsAppTemplateData): Promise<boolean> {
    const buyer = data.buyerName || 'Student';
    const seller = data.sellerName || 'Seller';
    const amount = (data.amount || 0).toLocaleString();

    const message = `🔒 *ERRANDERS BARTER: PAYMENT SECURED IN ESCROW*
${WhatsAppService.DIVIDER}
👋 Hi *${buyer}*, your payment has been secured!

🧾 *Amount:* ₦${amount}
📦 *Item:* "${data.itemTitle}"
👤 *Seller:* ${seller}

🛡️ *Your money is 100% safe:*
Funds are locked in Erranders Escrow until you meet the seller, inspect the item, and approve it in your dashboard.

💬 Reply directly to this WhatsApp message if you have questions.`;

    return this.sendWhatsApp(buyerPhone, message);
  }

  /**
   * 3. Escrow Released / Item Sold Out (Sent to Seller)
   */
  async notifySellerFundsReleased(sellerPhone: string, data: { sellerName?: string; buyerName?: string; itemTitle: string; payout: number }): Promise<boolean> {
    const seller = data.sellerName || 'Student';
    const buyer = data.buyerName || 'The buyer';
    const payout = (data.payout || 0).toLocaleString();

    const message = `🎉 *ERRANDERS BARTER: FUNDS RELEASED TO WALLET!*
${WhatsAppService.DIVIDER}
👋 Hi *${seller}*, congratulations!

*${buyer}* has confirmed receipt of *"${data.itemTitle}"*.

💰 *₦${payout}* has been credited to your Erranders Barter wallet and is available for instant withdrawal to your bank account!

🚀 Thanks for trading on Erranders Barter.`;

    return this.sendWhatsApp(sellerPhone, message);
  }

  /**
   * 4. New Swap / Purchase Offer (Sent to Item Owner)
   */
  async notifyNewOffer(receiverPhone: string, data: OfferWhatsAppTemplateData): Promise<boolean> {
    const receiver = data.receiverName || 'Student';
    const proposer = data.proposerName || 'A fellow student';

    let offerDetail = '';
    if (data.offeredItemTitle) {
      offerDetail += `\n🔄 *Offered in exchange:* "${data.offeredItemTitle}"`;
    }
    const cashExtra = data.cashTopUp || data.cashDifference;
    if (cashExtra) {
      offerDetail += `\n💵 *Cash addition:* ₦${cashExtra.toLocaleString()}`;
    }

    const message = `🔄 *ERRANDERS BARTER: NEW OFFER RECEIVED*
${WhatsAppService.DIVIDER}
👋 Hi *${receiver}*, you have an offer!

*${proposer}* sent an offer on your item:
📦 *"${data.targetItemTitle}"*${offerDetail}

⚡ Log into your Barter dashboard to accept, counter, or decline.`;

    return this.sendWhatsApp(receiverPhone, message);
  }

  /**
   * 4b. Offer accepted by the receiver (sent to the person who proposed it).
   *
   * The proposer's next move is a confirmation, so the message says that rather than "accepted" and
   * leaving them to guess whether the swap is agreed.
   */
  async notifyOfferAccepted(proposerPhone: string, data: { proposerName?: string; targetItemTitle?: string; receiverName?: string; offeredItemTitle?: string }): Promise<boolean> {
    const proposer = data.proposerName || 'Student';
    const receiver = data.receiverName || 'the seller';

    const message = `✅ *ERRANDERS BARTER: OFFER ACCEPTED*
${WhatsAppService.DIVIDER}
👋 *${proposer}*, ${receiver} accepted your offer.

📦 *"${data.targetItemTitle || 'the item'}"*${data.offeredItemTitle ? `\n🔄 In exchange for *"${data.offeredItemTitle}"*` : ''}

👉 Open the app to confirm the swap and arrange handover. The swap is not final until you both agree.`;

    return this.sendWhatsApp(proposerPhone, message);
  }

  /**
   * 4c. Offer declined or withdrawn.
   */
  async notifyOfferClosed(phone: string, data: { name?: string; targetItemTitle?: string; reason?: string }): Promise<boolean> {
    const name = data.name || 'Student';
    const reason = data.reason ? `\n\n_${data.reason}_` : '';

    const message = `❌ *ERRANDERS BARTER: OFFER CLOSED*
${WhatsAppService.DIVIDER}
Hi *${name}*, the offer on *"${data.targetItemTitle || 'your item'}"* was declined.${reason}

The item is still listed, so other students can still make an offer.`;

    return this.sendWhatsApp(phone, message);
  }

  /**
   * 4d. A listing went live.
   *
   * Confirmation to the seller, because "did it publish?" is the question every first-time seller has.
   * When a group is configured the listing also goes out to the campus feed.
   */
  async notifyListingPublished(
    sellerPhone: string | undefined,
    data: { sellerName?: string; title: string; price?: number; type?: string; url?: string; imageUrl?: string; groupJid?: string },
  ): Promise<boolean> {
    const seller = data.sellerName || 'Student';
    const isService = data.type === 'service';
    const priceLine = data.price ? `\n💰 *₦${Number(data.price).toLocaleString()}*` : '';

    let sent = false;
    if (sellerPhone) {
      const message = `🎉 *ERRANDERS BARTER: LISTING LIVE*
${WhatsAppService.DIVIDER}
Hi *${seller}*, your ${isService ? 'service' : 'item'} is live on campus.

📦 *"${data.title}"*${priceLine}

Share the link with your hostel group to sell faster.${data.url ? `\n🔗 ${data.url}` : ''}`;

      sent = await this.sendWhatsApp(sellerPhone, message);
    }

    if (data.groupJid) {
      const feed = `🆕 *NEW ON CAMPUS*
${WhatsAppService.DIVIDER}
📦 *"${data.title}"*${priceLine}
${isService ? '🛠 Service' : '🏷 For sale'}${data.url ? `\n🔗 ${data.url}` : ''}

${data.url ? 'Tap the link to view and offer.' : 'Open Decluttered to view it.'}`;
      await this.sendWhatsApp(data.groupJid, feed);
    }

    return sent;
  }

  /**
   * 5. New Service Booking (Sent to Service Provider)
   */
  async notifyProviderBooking(providerPhone: string, data: BookingWhatsAppTemplateData): Promise<boolean> {
    const provider = data.providerName || 'Provider';
    const client = data.clientName || 'A student client';
    const amount = (data.amount || 0).toLocaleString();
    const time = data.timeSlot || 'Scheduled time';

    const message = `✂️ *ERRANDERS BARTER: NEW SERVICE BOOKING*
${WhatsAppService.DIVIDER}
👋 Hi *${provider}*, you have a new booking request!

👤 *Client:* ${client}
🛠️ *Service:* ${data.serviceTitle}
📅 *Date & Time:* ${data.bookingDate || 'Scheduled date'} (${time})
💰 *Amount:* ₦${amount}

⚡ Please check your provider dashboard to review and confirm this booking.`;

    return this.sendWhatsApp(providerPhone, message);
  }

  /**
   * 6. Service Booking Approved (Sent to Client)
   */
  async notifyClientBookingConfirmed(clientPhone: string, data: BookingWhatsAppTemplateData): Promise<boolean> {
    const client = data.clientName || 'Student';
    const provider = data.providerName || 'Your service provider';
    const time = data.timeSlot || 'Scheduled time';

    const message = `✅ *ERRANDERS BARTER: BOOKING CONFIRMED*
${WhatsAppService.DIVIDER}
👋 Hi *${client}*, your appointment is confirmed!

🛠️ *Service:* ${data.serviceTitle}
👤 *Provider:* ${provider}
📅 *Date:* ${data.bookingDate || 'Confirmed date'} (${time})

💬 Reply directly to this WhatsApp message if you need to reschedule or have questions.`;

    return this.sendWhatsApp(clientPhone, message);
  }

  /**
   * Ask Evolution for the picture attached to a message.
   *
   * Returns a data URL so it can be uploaded to Cloudinary the same way a browser upload would be. Any
   * failure returns null: a listing without a photo is still a listing, so this never blocks ingestion.
   */
  async fetchMediaDataUrl(item: any): Promise<string | null> {
    const evoUrl = this.configService.get<string>('WHATSAPP_EVOLUTION_API_URL')?.replace(/\/$/, '');
    const evoKey = this.configService.get<string>('WHATSAPP_EVOLUTION_API_KEY');
    const evoInstance = this.configService.get<string>('WHATSAPP_EVOLUTION_INSTANCE');
    if (!evoUrl || !evoKey || !evoInstance) return null;

    try {
      const response = await fetch(`${evoUrl}/chat/getBase64FromMediaMessage/${evoInstance}`, {
        method: 'POST',
        headers: { apikey: evoKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: item, convertToMp4: false }),
      });
      const body: any = await response.json().catch(() => ({}));
      const base64 = body?.base64 || body?.data?.base64;
      const mime = body?.mimetype || body?.data?.mimetype || item?.message?.imageMessage?.mimetype || 'image/jpeg';
      if (!base64) return null;
      return base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`;
    } catch {
      return null;
    }
  }

  private async resolveParticipantPhone(groupJid: string, rawSender: string, alt?: string): Promise<string> {
    if (alt && !alt.includes('@lid')) {
      return alt.replace(/@.*$/, '').replace(/:\d+$/, '');
    }
    if (!rawSender.includes('@lid')) {
      return rawSender.replace(/@.*$/, '').replace(/:\d+$/, '');
    }

    const cleanLid = rawSender.replace(/@.*$/, '').replace(/:\d+$/, '');
    const now = Date.now();
    let cached = this.groupParticipantCache.get(groupJid);

    if (!cached || now - cached.fetchedAt > 5 * 60 * 1000) {
      const evoUrl = this.configService.get<string>('WHATSAPP_EVOLUTION_API_URL')?.replace(/\/$/, '');
      const evoKey = this.configService.get<string>('WHATSAPP_EVOLUTION_API_KEY');
      const evoInstance = this.configService.get<string>('WHATSAPP_EVOLUTION_INSTANCE') || 'Erranders';
      const lidMap = new Map<string, string>();

      try {
        const res = await fetch(`${evoUrl}/group/findGroupInfos/${evoInstance}?groupJid=${encodeURIComponent(groupJid)}`, {
          headers: { apikey: evoKey || '' },
          signal: AbortSignal.timeout(6000),
        });
        const data: any = await res.json().catch(() => ({}));
        const participants = Array.isArray(data?.participants) ? data.participants : [];
        for (const p of participants) {
          const lid = String(p.id || '').replace(/@.*$/, '');
          const phone = String(p.phoneNumber || '').replace(/@.*$/, '');
          if (lid && phone) lidMap.set(lid, phone);
        }
      } catch (e: any) {
        this.logger.warn(`Could not resolve group participants for LID resolution: ${e?.message || e}`);
      }
      cached = { fetchedAt: now, map: lidMap };
      this.groupParticipantCache.set(groupJid, cached);
    }

    return cached.map.get(cleanLid) || cleanLid;
  }

  /**
   * A message in one of the feed groups.
   *
   * Only the configured groups are read. The bot strictly ignores:
   * 1. Quoted replies or chat conversations between group members.
   * 2. Messages without an explicit, valid item price.
   * 3. Senders who were already prompted within the last 10 minutes.
   */
  private async ingestGroupPost(item: any, groupJid: string) {
    const groupJids = await this.feedGroupJids();
    if (!groupJids.includes(groupJid)) return;

    const key = item?.key || {};
    const message = item?.message || {};

    // 1. NEVER intercept replies or quotes (conversations in the group)
    if (
      message?.extendedTextMessage?.contextInfo?.quotedMessage ||
      item?.contextInfo?.quotedMessage ||
      key.fromMe === true
    ) {
      return;
    }

    const caption = String(
      message?.imageMessage?.caption ||
      message?.videoMessage?.caption ||
      message?.conversation ||
      message?.extendedTextMessage?.text ||
      '',
    ).trim();
    if (!caption) return;

    const { ItemsService } = require('../items/items.service');
    const items = this.moduleRef.get(ItemsService, { strict: false });
    if (!items) return;

    // 2. MUST have an explicit price. If no price is found, this is general chat/questions — IGNORE!
    const price = items.priceFromText(caption);
    if (!price) {
      return;
    }

    // 3. Resolve sender phone number (resolving WhatsApp privacy LIDs to actual phone numbers)
    const rawSender = String(key.participant || key.remoteJid || '');
    const altSender = String(key.participantAlt || item.participantAlt || '');
    const sender = await this.resolveParticipantPhone(groupJid, rawSender, altSender);
    const senderDigits = sender.replace(/\D/g, '');
    if (!senderDigits || senderDigits.length < 10) return;

    // 4. Rate-limit signup prompts per phone number (cooldown of 10 minutes)
    const now = Date.now();
    const lastPrompted = this.recentlyPromptedNumbers.get(senderDigits);
    if (lastPrompted && now - lastPrompted < 10 * 60 * 1000) {
      return;
    }

    const hasPhoto = Boolean(message?.imageMessage || message?.videoMessage);
    const media = hasPhoto ? await this.fetchMediaDataUrl(item) : null;

    const result = await items.ingestFromWhatsApp({ phone: sender, text: caption, mediaDataUrl: media });

    if (result?.created) {
      await this.sendWhatsApp(
        groupJid,
        `✅ *Listed on Decluttered*\n${WhatsAppService.DIVIDER}\n📦 *${result.item.title}*\n💰 ₦${Number(result.item.price).toLocaleString()}\n\n🔗 ${result.url}\n\nThe seller can edit or remove it in the app.`,
      );
      return;
    }

    const senderJid = `${senderDigits}@s.whatsapp.net`;
    const senderTag = `@${senderDigits}`;

    // 5. Prompt ONLY when an unregistered user posts an item with an actual price
    if (result?.reason === 'no-account' && result.price) {
      this.recentlyPromptedNumbers.set(senderDigits, now);

      const itemTitle = result.title ? `*${result.title}*` : 'your item';
      const itemPrice = ` for *₦${Number(result.price).toLocaleString()}*`;

      const promptMsg =
        `👋 Hi ${senderTag}!\n\n` +
        `I noticed you want to sell ${itemTitle}${itemPrice}, but this WhatsApp number is not registered on *Erranders Declutter* yet.\n\n` +
        `📝 *How to get this uploaded to the website:*\n` +
        `1️⃣ *Create your free account* (takes 30 seconds):\n` +
        `👉 https://decluttered.erranders.org/signup?phone=${senderDigits.slice(-10)}\n` +
        `*(Make sure to sign up with this WhatsApp number!)*\n\n` +
        `2️⃣ *Post anytime with price & photo:*\n` +
        `Whenever you share an item in this group with:\n` +
        `• 📸 Photo of the item\n` +
        `• 🏷️ Name & description\n` +
        `• 💰 Price (e.g. 15k or ₦15,000)\n\n` +
        `I will automatically detect it and publish it directly to the website with 100% Escrow Protection so campus buyers can order it safely! 🚀`;

      await this.sendWhatsApp(groupJid, promptMsg, { mentioned: [senderJid] });
    }
  }

  private async feedGroupJids(): Promise<string[]> {
    try {
      const perCampus: any = await this.settingModel.findOne({ key: 'declutter_feed_groups' }).lean();
      const groups = Array.isArray(perCampus?.value) ? perCampus.value : [];
      const jids = groups.map((g: any) => String(g.jid)).filter(Boolean);
      if (jids.length) return jids;

      const single: any = await this.settingModel.findOne({ key: 'declutter_feed_group' }).lean();
      if (single?.value?.jid) return [String(single.value.jid)];
    } catch {
      // fall through to the environment
    }
    return process.env.DECLUTTER_FEED_GROUP_JID ? [process.env.DECLUTTER_FEED_GROUP_JID] : [];
  }

  // ─── Evolution Webhook Handler ─────────────────────────────────────────────

  async handleEvolutionWebhook(payload: any, headers?: any): Promise<{ success: boolean; event?: string }> {
    this.logger.log(`Received Evolution Webhook: ${JSON.stringify(payload)}`);

    const event = String(payload?.event || payload?.type || '').toLowerCase().replace(/_/g, '.');

    if (event === 'messages.upsert') {
      const data = payload?.data;
      const items = Array.isArray(data) ? data : data ? [data] : [];

      for (const item of items) {
        const key = item?.key;
        if (!key || key.fromMe === true) continue; // Skip bot's own outgoing messages

        const remoteJid = String(key.remoteJid || '');
        if (!remoteJid || remoteJid.includes('status@broadcast')) continue;

        if (remoteJid.endsWith('@g.us')) {
          // A post in a campus feed group becomes a listing, when it has a price and the sender has an account.
          await this.ingestGroupPost(item, remoteJid).catch((e) =>
            this.logger.warn(`Group ingestion failed: ${e?.message || e}`),
          );
          continue;
        }

        const fromNumber = remoteJid.replace(/@.*$/, '');
        const messageObj = item?.message;
        const inboundText = String(
          messageObj?.conversation ||
          messageObj?.extendedTextMessage?.text ||
          messageObj?.imageMessage?.caption ||
          messageObj?.videoMessage?.caption ||
          messageObj?.buttonsResponseMessage?.selectedDisplayText ||
          '',
        ).trim();

        if (fromNumber && inboundText) {
          this.logger.log(`Inbound Evolution WhatsApp from ${fromNumber}: "${inboundText}"`);

          const forwardNotice = `📩 *ERRANDERS BARTER: CUSTOMER WHATSAPP REPLY*
${WhatsAppService.DIVIDER}
A user sent a reply via WhatsApp:

👤 *From:* ${fromNumber}
💬 *Message:*
"${inboundText}"

${WhatsAppService.DIVIDER}
⚡ *Action:* Please review active escrow/order or respond to customer.`;

          const supportPhones = this.getSupportPhones();
          for (const supportPhone of supportPhones) {
            await this.sendWhatsApp(supportPhone, forwardNotice);
          }
        }
      }
    }

    return { success: true, event };
  }
}
