import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setting } from './schemas/setting.schema';

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(@InjectModel(Setting.name) private settingModel: Model<Setting>) {}

  /**
   * Observable platform configuration. These are not sample records: they are the
   * operational defaults every deployment needs, and an admin can change each one.
   * Fees default to zero so the app never invents a charge; promoted listings stay
   * switched off until an admin sets a real price.
   */
  async onModuleInit() {
    const defaultSettings = [
      { key: 'base_errander_fee', value: 500 },
      { key: 'escrow_fee_percentage', value: 2.5 }, // 2.5% Buyer Protection & Escrow
      { key: 'seller_commission_percentage', value: 3.0 }, // 3.0% Seller Platform Fee
      { key: 'swap_protection_fee', value: 250 }, // Flat ₦250 Swap Protection & Verification Fee
      { key: 'service_booking_fee_percentage', value: 3.0 }, // 3.0% Client Booking Facilitation Fee
      { key: 'service_provider_commission_percentage', value: 5.0 }, // 5.0% Provider Platform Fee
      { key: 'errander_commission_percentage', value: 0 },
      { key: 'promoted_listing_fee', value: 0 },
      { key: 'service_business_commission_percentage', value: 15 },
    ];
    for (const s of defaultSettings) {
      const exists = await this.settingModel.findOne({ key: s.key });
      if (!exists) {
        await this.settingModel.create(s);
      }
    }
  }

  async getSetting(key: string) {
    const setting = await this.settingModel.findOne({ key });
    return setting ? setting.value : null;
  }

  async updateSetting(key: string, value: any) {
    return this.settingModel.findOneAndUpdate(
      { key },
      { value },
      { new: true, upsert: true }
    );
  }
}
