import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Paystack list responses are paginated; 100 is the largest page it serves in one call and
// comfortably covers the Nigerian bank list.
const BANK_LIST_PAGE_SIZE = 100;
// Banks change rarely, so the list is cached in memory to keep /banks off the Paystack quota.
const BANKS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_LENGTH = 300;

export interface PaystackBank {
  code: string;
  name: string;
  slug?: string;
}

export interface PaystackResolvedAccount {
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

export interface PaystackTransferRecipient {
  recipientCode: string;
  name?: string;
  accountNumber?: string;
  bankName?: string;
}

export interface PaystackTransfer {
  transferCode: string;
  status: string;
  reference: string;
}

export interface PaystackTransferVerification {
  transferCode?: string;
  status: string;
  reference: string;
  amount: number;
}

export interface CreateTransferRecipientInput {
  name: string;
  accountNumber: string;
  bankCode: string;
}

export interface InitiateTransferInput {
  amount: number;
  reference: string;
  recipient: string;
  reason?: string;
}

interface PaystackEnvelope<T> {
  status?: boolean | string;
  message?: string;
  data?: T;
}

interface PaystackRawBank {
  name?: string;
  code?: string;
  slug?: string;
  currency?: string;
  active?: boolean;
  supports_transfer?: boolean;
}

interface PaystackRawResolvedAccount {
  account_number?: string;
  account_name?: string;
}

interface PaystackRawRecipient {
  recipient_code?: string;
  name?: string;
  details?: { account_number?: string; bank_name?: string };
}

interface PaystackRawTransfer {
  transfer_code?: string;
  status?: string;
  reference?: string;
  amount?: number;
}

/**
 * Typed client for the Paystack payout API, built on the runtime's global fetch (no HTTP
 * dependency is added to the project). Every non-2xx response is surfaced as an exception
 * carrying Paystack's own message; nothing is silently swallowed or simulated.
 */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private banksCache: { banks: PaystackBank[]; fetchedAt: number } | null = null;

  constructor(private readonly configService: ConfigService) {
    // Log (never print) the configuration problem once at boot; request methods still fail
    // loudly on every call so a missing key can never turn into an empty bearer token.
    if (!this.secretKey) {
      this.logger.error(
        'PAYSTACK_SECRET_KEY is not set. Paystack payouts are disabled until it is configured.',
      );
    }
  }

  private get secretKey(): string {
    return (this.configService.get<string>('PAYSTACK_SECRET_KEY') || '').trim();
  }

  private requireSecretKey(): string {
    const secretKey = this.secretKey;
    if (!secretKey) {
      throw new ServiceUnavailableException(
        'Paystack is not configured: PAYSTACK_SECRET_KEY is missing. No funds were moved.',
      );
    }
    return secretKey;
  }

  /**
   * Calls Paystack and normalises the response envelope. Paystack reports errors as non-2xx
   * responses with their own `message`; that message is always forwarded to the caller and
   * logged server-side (the secret key is never logged).
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    action: string,
    body?: unknown,
  ): Promise<T> {
    const secretKey = this.requireSecretKey();
    const url = `${this.baseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Paystack ${action} could not be reached: ${error.message}`);
      throw new BadGatewayException(
        `Could not reach Paystack while attempting ${action}. Please try again.`,
      );
    }

    const rawBody = await response.text();
    let payload: PaystackEnvelope<T> | null = null;
    try {
      payload = rawBody ? (JSON.parse(rawBody) as PaystackEnvelope<T>) : null;
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.status === false) {
      const detail =
        payload?.message ||
        rawBody.slice(0, MAX_ERROR_BODY_LENGTH) ||
        `HTTP ${response.status}`;
      this.logger.error(`Paystack ${action} failed (HTTP ${response.status}): ${detail}`);

      // Never forward Paystack's 401 to the client as this API's 401 — that would look like
      // an expired login. Misconfiguration is a server-side outage.
      if (response.status === 401 || response.status === 403) {
        throw new ServiceUnavailableException(
          `Paystack rejected the configured credentials (HTTP ${response.status}): ${detail}`,
        );
      }
      if (response.status === 429) {
        throw new ServiceUnavailableException(`Paystack rate limit reached: ${detail}`);
      }
      if (response.status >= 500) {
        throw new BadGatewayException(`Paystack ${action} failed: ${detail}`);
      }
      throw new BadRequestException(`Paystack ${action} failed: ${detail}`);
    }

    if (!payload) {
      this.logger.error(`Paystack ${action} returned an unreadable response (HTTP ${response.status})`);
      throw new BadGatewayException(`Paystack ${action} returned an unreadable response.`);
    }

    return payload.data as T;
  }

  /** Nigerian bank list, trimmed and cached for a few hours. */
  async listBanks(): Promise<PaystackBank[]> {
    if (this.banksCache && Date.now() - this.banksCache.fetchedAt < BANKS_CACHE_TTL_MS) {
      return this.banksCache.banks;
    }

    const rawBanks = await this.request<PaystackRawBank[]>(
      'GET',
      `/bank?country=nigeria&perPage=${BANK_LIST_PAGE_SIZE}`,
      'bank list request',
    );

    if (!Array.isArray(rawBanks)) {
      throw new BadGatewayException('Paystack bank list response was not a list.');
    }

    // Paystack lists USD variants of the same bank and some microfinance banks that cannot
    // receive NGN transfers. Withdrawals are NGN-only, so keep transfer-capable NGN banks,
    // de-duplicated by code.
    const seenCodes = new Set<string>();
    const banks: PaystackBank[] = [];
    for (const bank of rawBanks) {
      if (!bank?.code || !bank?.name) continue;
      if (bank.currency && bank.currency !== 'NGN') continue;
      if (bank.active === false || bank.supports_transfer === false) continue;

      const code = String(bank.code);
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      banks.push({ code, name: String(bank.name), slug: bank.slug });
    }
    banks.sort((a, b) => a.name.localeCompare(b.name));

    this.banksCache = { banks, fetchedAt: Date.now() };
    return banks;
  }

  /** Resolves an account number/bank code pair to the real account holder name. */
  async resolveAccount(accountNumber: string, bankCode: string): Promise<PaystackResolvedAccount> {
    const data = await this.request<PaystackRawResolvedAccount>(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      'account resolution',
    );

    const accountName = (data?.account_name || '').trim();
    if (!accountName) {
      throw new BadGatewayException(
        'Paystack could not resolve an account name for those bank details.',
      );
    }

    return { accountNumber, accountName, bankCode };
  }

  /** Creates (or returns) the Paystack transfer recipient used for payouts. */
  async createTransferRecipient(
    input: CreateTransferRecipientInput,
  ): Promise<PaystackTransferRecipient> {
    const data = await this.request<PaystackRawRecipient>(
      'POST',
      '/transferrecipient',
      'transfer recipient creation',
      {
        type: 'nuban',
        name: input.name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: 'NGN',
      },
    );

    const recipientCode = (data?.recipient_code || '').trim();
    if (!recipientCode) {
      throw new BadGatewayException(
        'Paystack did not return a transfer recipient code; no payout was attempted.',
      );
    }

    return {
      recipientCode,
      name: data?.name,
      accountNumber: data?.details?.account_number,
      bankName: data?.details?.bank_name,
    };
  }

  /**
   * Initiates an outbound transfer from the Paystack balance. `amount` is in naira and is
   * converted to the kobo Paystack expects.
   */
  async initiateTransfer(input: InitiateTransferInput): Promise<PaystackTransfer> {
    const amountInKobo = Math.round(input.amount * 100);
    if (!Number.isFinite(amountInKobo) || amountInKobo <= 0) {
      throw new BadRequestException('Transfer amount must be a positive number.');
    }

    const data = await this.request<PaystackRawTransfer>('POST', '/transfer', 'transfer initiation', {
      source: 'balance',
      amount: amountInKobo,
      reference: input.reference,
      recipient: input.recipient,
      reason: input.reason,
      currency: 'NGN',
    });

    const transferCode = (data?.transfer_code || '').trim();
    if (!transferCode) {
      throw new BadGatewayException(
        'Paystack did not return a transfer code; the transfer was not created.',
      );
    }

    return {
      transferCode,
      status: data?.status || 'pending',
      reference: data?.reference || input.reference,
    };
  }

  /** Verifies a transfer by the reference this backend generated. */
  async verifyTransfer(reference: string): Promise<PaystackTransferVerification> {
    const data = await this.request<PaystackRawTransfer>(
      'GET',
      `/transfer/verify/${encodeURIComponent(reference)}`,
      'transfer verification',
    );

    return {
      transferCode: data?.transfer_code,
      status: data?.status || 'unknown',
      reference: data?.reference || reference,
      amount: Number(data?.amount || 0) / 100, // kobo -> naira
    };
  }
}
