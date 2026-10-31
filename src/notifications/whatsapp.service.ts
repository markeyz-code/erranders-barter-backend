import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private readonly configService: ConfigService) {}

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
  async sendWhatsApp(phone: string, text: string): Promise<boolean> {
    if (!phone || !text) return false;
    const formattedPhone = this.formatPhoneNumber(phone);

    const evoUrl = this.configService.get<string>('WHATSAPP_EVOLUTION_API_URL')?.replace(/\/$/, '');
    const evoKey = this.configService.get<string>('WHATSAPP_EVOLUTION_API_KEY');
    const evoInstance = this.configService.get<string>('WHATSAPP_EVOLUTION_INSTANCE') || 'ojaly';

    try {
      if (!evoUrl || !evoKey) {
        this.logger.warn('WHATSAPP_EVOLUTION_API_URL or WHATSAPP_EVOLUTION_API_KEY is not configured');
        return false;
      }

      const digitsOnly = formattedPhone.replace(/\D/g, '');
      const response = await fetch(`${evoUrl}/message/sendText/${evoInstance}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: evoKey,
        },
        body: JSON.stringify({
          number: digitsOnly,
          text,
        }),
        signal: AbortSignal.timeout(15000),
      });

      const data = (await response.json().catch(() => ({}))) as any;
      if (!response.ok) {
        throw new Error(data?.message || data?.error || `Evolution API ${response.status}`);
      }

      const msgId = data?.key?.id || data?.id || 'ok';
      this.logger.log(`✅ WhatsApp sent to ${digitsOnly}. Message ID: ${msgId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`❌ WhatsApp Failed to ${formattedPhone}: ${error.message}`);
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
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.includes('status@broadcast')) {
          continue; // Skip group chats and broadcast updates
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
