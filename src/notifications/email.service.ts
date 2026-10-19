import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private transporter: nodemailer.Transporter | null = null;
  private readonly fromEmail: string;

  // In-memory token management: cooldown map to prevent duplicate/spam broadcasts
  private static alertCooldownCache: Map<string, number> = new Map();

  constructor() {
    this.fromEmail =
      process.env.EMAIL_FROM ||
      'Erranders Declutter <notifications@decluttered.erranders.org>';

    const resendKey = (
      process.env.RESEND_API_KEY ||
      process.env.EMAIL_API_KEY ||
      ''
    )
      .trim()
      .replace(/['"]+/g, '');

    if (resendKey) {
      try {
        this.resend = new Resend(resendKey);
        this.logger.log(
          `Resend client configured for Declutter: sending from ${this.fromEmail}`,
        );
      } catch (err: any) {
        this.logger.warn(`Failed to initialize Resend: ${err?.message || err}`);
      }
    }

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = Number(process.env.SMTP_PORT) || 587;

    if (host && user && pass) {
      try {
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        });
        this.logger.log(`SMTP configured: sending via ${host}:${port}`);
      } catch (err: any) {
        this.logger.warn(`Failed to initialize SMTP transporter: ${err.message}`);
      }
    } else if (!this.resend) {
      this.logger.log('Email provider not fully configured; transactional emails will be logged.');
    }
  }

  private wrapTemplate(title: string, contentHtml: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);" cellspacing="0" cellpadding="0">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px; text-align: left;">
              <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">
                Erranders <span style="color: #f97316;">Declutter.</span>
              </h2>
              <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 12px; font-weight: 600;">Campus Student Room Clearance & Marketplace</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Escrow trust note -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <table role="presentation" width="100%" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 12px 16px;" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 12px; font-weight: 700; color: #166534;">
                      🛡️ Erranders Escrow Protected: Funds and bookings are safe and verified.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b; font-weight: 500;">
                You received this email because of your account activity on Erranders Declutter.
              </p>
              <p style="margin: 4px 0 0 0; font-size: 11px; color: #94a3b8;">
                © ${new Date().getFullYear()} Erranders. All rights reserved. • decluttered.erranders.org
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  async sendEmail(to: string, subject: string, htmlContent: string): Promise<boolean> {
    if (!to || !to.includes('@')) {
      this.logger.warn(`Skipping invalid recipient address: "${to}"`);
      return false;
    }

    // Skip simulated test recipients to save email quota/tokens
    if (to.endsWith('@barter.test') || to.endsWith('@errandr.test') || to.endsWith('.example')) {
      this.logger.log(`[SIMULATED - QUOTA SAVED] To: ${to} | Subject: "${subject}"`);
      return true;
    }

    const fullHtml = this.wrapTemplate(subject, htmlContent);

    // Primary: Resend via dedicated Declutter API Key & domain
    if (this.resend) {
      try {
        const payload: any = {
          from: this.fromEmail,
          to: Array.isArray(to) ? to : [to],
          subject: `${subject} | Erranders Declutter`,
          html: fullHtml,
          replyTo: 'hello@decluttered.erranders.org',
        };

        const { data, error } = await this.resend.emails.send(payload);

        if (error) {
          this.logger.error(`Resend API error to ${to}: ${error.message}`);
          return false;
        }

        this.logger.log(`✅ Declutter Email dispatched via Resend to ${to} (ID: ${data?.id}): "${subject}"`);
        return true;
      } catch (err: any) {
        this.logger.error(`Exception dispatching email via Resend to ${to}: ${err?.message || err}`);
      }
    }

    // Secondary fallback: SMTP if configured
    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.fromEmail,
          to,
          subject: `${subject} | Erranders Declutter`,
          html: fullHtml,
        });
        this.logger.log(`Email dispatched via SMTP to ${to}: "${subject}"`);
        return true;
      } catch (err: any) {
        this.logger.error(`Error sending email to ${to}: ${err?.message || err}`);
      }
    }

    // Development logging
    this.logger.log(`[DISPATCH EMAIL SIMULATION] To: ${to} | Subject: "${subject}"`);
    return true;
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
    const html = `
      <h3 style="margin-top: 0; color: #0f172a; font-size: 18px; font-weight: 800;">
        Reset Your Password 🔐
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        We received a request to reset your password for your <strong>Erranders Declutter</strong> account. Click the button below to choose a new password:
      </p>
      <div style="margin: 24px 0;">
        <a href="${resetUrl}" style="background-color: #f97316; color: #ffffff; padding: 12px 24px; border-radius: 10px; font-weight: 700; text-decoration: none; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
        This link is valid for 1 hour. If you didn't request a password reset, you can safely ignore this email.
      </p>
    `;
    return this.sendEmail(to, 'Reset your Erranders Declutter password', html);
  }

  // --- Specific Email Triggers ---

  async sendBookingRequested(
    providerEmail: string,
    providerName: string,
    customerName: string,
    serviceTitle: string,
    date: string,
    startTime: string,
    endTime: string,
    amount: number,
    notes?: string,
  ) {
    const html = `
      <h3 style="margin-top: 0; color: #0f172a; font-size: 18px; font-weight: 800;">
        New Booking Request! 🎉
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Hello <strong>${providerName}</strong>, <strong>${customerName}</strong> has requested to book your service:
      </p>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 800; color: #0f172a;">${serviceTitle}</p>
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #475569;">📅 <strong>Date:</strong> ${date}</p>
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #475569;">⏰ <strong>Time Window:</strong> ${startTime} – ${endTime}</p>
        <p style="margin: 0; font-size: 13px; color: #ea580c; font-weight: 800;">💰 <strong>Amount:</strong> ₦${amount.toLocaleString()}</p>
        ${notes ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b; font-style: italic;">Note: "${notes}"</p>` : ''}
      </div>

      <p style="font-size: 14px; color: #475569;">
        Please log into your dashboard to accept or coordinate this booking with the student.
      </p>
    `;
    return this.sendEmail(providerEmail, `New Booking Request from ${customerName}`, html);
  }

  async sendBookingConfirmed(
    customerEmail: string,
    customerName: string,
    providerName: string,
    serviceTitle: string,
    date: string,
    startTime: string,
    endTime: string,
    meetingUrl?: string,
  ) {
    const html = `
      <h3 style="margin-top: 0; color: #166534; font-size: 18px; font-weight: 800;">
        Your Booking is Confirmed! ✅
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Hello <strong>${customerName}</strong>, good news! <strong>${providerName}</strong> has accepted your booking request:
      </p>

      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 800; color: #14532d;">${serviceTitle}</p>
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #166534;">📅 <strong>Date:</strong> ${date}</p>
        <p style="margin: 0; font-size: 13px; color: #166534;">⏰ <strong>Time:</strong> ${startTime} – ${endTime}</p>
        ${meetingUrl ? `<p style="margin: 8px 0 0 0; font-size: 13px;"><a href="${meetingUrl}" style="color: #2563eb; font-weight: 700;">Join Video Meeting →</a></p>` : ''}
      </div>

      <p style="font-size: 14px; color: #475569;">
        You can chat with ${providerName} anytime via Barter messages.
      </p>
    `;
    return this.sendEmail(customerEmail, `Booking Confirmed: ${serviceTitle}`, html);
  }

  async sendBookingCancelled(
    recipientEmail: string,
    recipientName: string,
    cancelledByName: string,
    serviceTitle: string,
    date: string,
    time: string,
    reason: string,
  ) {
    const html = `
      <h3 style="margin-top: 0; color: #991b1b; font-size: 18px; font-weight: 800;">
        Booking Cancelled
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Hello <strong>${recipientName}</strong>, the booking for <strong>${serviceTitle}</strong> scheduled for <strong>${date} at ${time}</strong> has been cancelled by <strong>${cancelledByName}</strong>.
      </p>
      <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 14px; margin: 16px 0;">
        <p style="margin: 0; font-size: 13px; color: #991b1b; font-weight: 600;">Reason: "${reason}"</p>
      </div>
      <p style="font-size: 14px; color: #475569;">
        The slot has been released back to the calendar.
      </p>
    `;
    return this.sendEmail(recipientEmail, `Booking Cancelled: ${serviceTitle}`, html);
  }

  async sendDeclutterSuccess(
    userEmail: string,
    userName: string,
    itemsCount: number,
    hostel: string,
    totalValuation: number,
  ) {
    const html = `
      <h3 style="margin-top: 0; color: #0f172a; font-size: 18px; font-weight: 800;">
        Room Declutter Published! 📦✨
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Hi <strong>${userName}</strong>, your automated room declutter batch of <strong>${itemsCount} items</strong> has been successfully published to your campus hostel (<strong>${hostel}</strong>).
      </p>
      <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 6px 0; font-size: 14px; color: #9a3412;">📦 <strong>Items:</strong> ${itemsCount} room items</p>
        <p style="margin: 0; font-size: 14px; color: #ea580c; font-weight: 800;">💰 <strong>Total Valuation:</strong> ₦${totalValuation.toLocaleString()}</p>
      </div>
      <p style="font-size: 14px; color: #475569;">
        Students moving in or staying on campus will be alerted. All deals are protected by Erranders Escrow!
      </p>
    `;
    return this.sendEmail(userEmail, `Room Declutter Batch Published (${itemsCount} Items)`, html);
  }

  async sendEscrowInitiated(
    sellerEmail: string,
    sellerName: string,
    buyerName: string,
    itemTitle: string,
    amount: number,
  ) {
    const html = `
      <h3 style="margin-top: 0; color: #166534; font-size: 18px; font-weight: 800;">
        Payment Received in Escrow! 💰🛡️
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Hi <strong>${sellerName}</strong>, <strong>${buyerName}</strong> has paid <strong>₦${amount.toLocaleString()}</strong> into Erranders Escrow for your listing:
      </p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 6px 0; font-size: 15px; font-weight: 800; color: #14532d;">${itemTitle}</p>
        <p style="margin: 0; font-size: 13px; color: #166534;">Status: <strong>Locked in Escrow (Item marked Pending)</strong></p>
      </div>
      <p style="font-size: 14px; color: #475569;">
        Please coordinate handover or delivery with the buyer. Once the buyer confirms receipt, the funds will be released instantly to your Barter wallet!
      </p>
    `;
    return this.sendEmail(sellerEmail, `Payment Held in Escrow for: ${itemTitle}`, html);
  }

  async sendItemSoldOut(
    sellerEmail: string,
    sellerName: string,
    itemTitle: string,
    buyerName: string,
    amount: number,
  ) {
    const html = `
      <h3 style="margin-top: 0; color: #0f172a; font-size: 18px; font-weight: 800;">
        Item Sold Out & Funds Released! 🚀🎉
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Congratulations <strong>${sellerName}</strong>! <strong>${buyerName}</strong> has confirmed receipt of <strong>"${itemTitle}"</strong>.
      </p>
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 4px 0; font-size: 14px; color: #475569;">Item: <strong>${itemTitle}</strong></p>
        <p style="margin: 0; font-size: 15px; color: #16a34a; font-weight: 800;">Credited to Wallet: ₦${amount.toLocaleString()}</p>
      </div>
      <p style="font-size: 14px; color: #475569;">
        This item is now marked as <strong>SOLD OUT</strong> on Barter. You can withdraw your earnings anytime to your Nigerian bank account.
      </p>
    `;
    return this.sendEmail(sellerEmail, `Sold Out: ${itemTitle} Payout Released`, html);
  }

  async sendPaymentReleased(
    providerEmail: string,
    providerName: string,
    serviceTitle: string,
    studentName: string,
    amount: number,
  ) {
    const html = `
      <h3 style="margin-top: 0; color: #0f172a; font-size: 18px; font-weight: 800;">
        Payment Released to Your Wallet! 💰🎉
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Hi <strong>${providerName}</strong>, <strong>${studentName}</strong> has completed the remaining balance payment for <strong>"${serviceTitle}"</strong>.
      </p>
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 4px 0; font-size: 14px; color: #475569;">Service: <strong>${serviceTitle}</strong></p>
        <p style="margin: 0; font-size: 15px; color: #16a34a; font-weight: 800;">Credited to Escrow Wallet: ₦${amount.toLocaleString()}</p>
      </div>
      <p style="font-size: 14px; color: #475569;">
        The funds have been credited to your Decluttered Wallet balance. You can withdraw anytime to your bank account.
      </p>
    `;
    return this.sendEmail(providerEmail, `Payment Released: ${serviceTitle}`, html);
  }

  async sendDeclutterHostelAlert(
    studentEmail: string,
    studentName: string,
    hostel: string,
    itemsCount: number,
    totalValuation: number,
  ) {
    // Token Management: 6-hour cooldown per student to protect daily Resend quota and avoid spamming
    const COOLDOWN_MS = 6 * 60 * 60 * 1000;
    const now = Date.now();
    const lastSent = EmailService.alertCooldownCache.get(studentEmail) || 0;
    if (now - lastSent < COOLDOWN_MS) {
      this.logger.log(
        `Token Management: Skipped alert email to ${studentEmail} (cooldown active, saving tokens)`,
      );
      return false;
    }
    EmailService.alertCooldownCache.set(studentEmail, now);

    const html = `
      <h3 style="margin-top: 0; color: #ea580c; font-size: 18px; font-weight: 800;">
        New Room Declutter in ${hostel}! 📦⚡
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Hey <strong>${studentName}</strong>, a fellow student in <strong>${hostel}</strong> just published a rapid room clearance batch with <strong>${itemsCount} items</strong> worth ₦${totalValuation.toLocaleString()}!
      </p>
      <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0; font-size: 13px; color: #9a3412; font-weight: 700;">
          Grab hostel deals before moveout clearance ends!
        </p>
      </div>
      <p style="font-size: 14px; color: #475569;">
        Check it out now on Decluttered with 100% Escrow Protection.
      </p>
    `;
    return this.sendEmail(studentEmail, `New Room Clearance Deals at ${hostel}!`, html);
  }
}

