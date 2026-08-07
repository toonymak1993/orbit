import type { StoreRegionId } from '@shared/ipc'

export interface StoreRegionConfig {
  id: StoreRegionId
  countryCode: string
  currency: string
  locale: string
  steamLanguage: string
}

export const STORE_REGIONS: Record<StoreRegionId, StoreRegionConfig> = {
  eu: { id: 'eu', countryCode: 'DE', currency: 'EUR', locale: 'de-DE', steamLanguage: 'german' },
  us: { id: 'us', countryCode: 'US', currency: 'USD', locale: 'en-US', steamLanguage: 'english' },
  gb: { id: 'gb', countryCode: 'GB', currency: 'GBP', locale: 'en-GB', steamLanguage: 'english' },
  ca: { id: 'ca', countryCode: 'CA', currency: 'CAD', locale: 'en-CA', steamLanguage: 'english' },
  au: { id: 'au', countryCode: 'AU', currency: 'AUD', locale: 'en-AU', steamLanguage: 'english' }
}

export function formatStorePrice(priceMinor: number, region: StoreRegionConfig): string {
  return new Intl.NumberFormat(region.locale, {
    style: 'currency',
    currency: region.currency
  }).format(priceMinor / 100)
}
