import { readFileSync } from 'node:fs'
import type { EpicAuthManager } from './epicAuth'
import { getEpicPortalConfigPath } from './epicInstall'

const DEFAULT_ENDPOINTS = {
  account: 'account-public-service-prod03.ol.epicgames.com',
  library: 'library-service.live.use1a.on.epicgames.com',
  catalog: 'catalog-public-service-prod06.ol.epicgames.com'
}

export interface EpicLibraryAsset {
  appName?: string
  labelName?: string
  buildVersion?: string
  catalogItemId?: string
  namespace?: string
  assetId?: string
  sandboxType?: string
}

export interface EpicCatalogAttribute {
  type?: string
  value?: string
}

export interface EpicCatalogItem {
  id?: string
  title?: string
  description?: string
  keyImages?: Array<{ url?: string; type?: string }>
  categories?: Array<{ path?: string }>
  namespace?: string
  status?: string
  creationDate?: string
  lastModifiedDate?: string
  customAttributes?: Record<string, EpicCatalogAttribute>
  entitlementName?: string
  entitlementType?: string
  itemType?: string
  releaseInfo?: Array<{ appId?: string; platform?: string[]; dateAdded?: string }>
  developer?: string
  developerId?: string
  endOfSupport?: boolean
  mainGameItem?: { id?: string }
}

export interface EpicPlaytimeItem {
  accountId?: string
  artifactId?: string
  totalTime?: number
}

interface EndpointHosts {
  account: string
  library: string
  catalog: string
}

function configuredHosts(): EndpointHosts {
  const configPath = getEpicPortalConfigPath()
  if (!configPath) return DEFAULT_ENDPOINTS
  try {
    const source = readFileSync(configPath, 'utf8')
    const sections = new Map<string, Map<string, string>>()
    let current: Map<string, string> | null = null
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith(';') || line.startsWith('#')) continue
      const section = line.match(/^\[(.+)]$/)
      if (section) {
        current = new Map()
        sections.set(section[1], current)
        continue
      }
      const separator = line.indexOf('=')
      if (!current || separator <= 0) continue
      current.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
    }
    const domain = (section: string): string | undefined =>
      sections.get(section)?.get('Domain')?.replace(/^https?:\/\//, '').replace(/\/$/, '')
    return {
      account:
        domain('Portal.OnlineSubsystemMcp.OnlineIdentityMcp Prod') ?? DEFAULT_ENDPOINTS.account,
      library:
        domain('Portal.OnlineSubsystemMcp.OnlineLibraryServiceMcp Prod') ?? DEFAULT_ENDPOINTS.library,
      catalog:
        domain('Portal.OnlineSubsystemMcp.OnlineCatalogServiceMcp Prod') ?? DEFAULT_ENDPOINTS.catalog
    }
  } catch {
    return DEFAULT_ENDPOINTS
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { errorCode?: string; errorMessage?: string })
    | null
  if (!response.ok || !body || body.errorCode) {
    throw new Error(body?.errorMessage || body?.errorCode || `Epic request failed (${response.status})`)
  }
  return body
}

/** Thin account client matching the endpoints and cursor flow used by Playnite. */
export class EpicApiClient {
  private hosts = configuredHosts()

  constructor(private readonly auth: EpicAuthManager) {}

  async getAssets(): Promise<EpicLibraryAsset[]> {
    const assets: EpicLibraryAsset[] = []
    let cursor: string | undefined
    let page = 0
    do {
      const url = new URL(`https://${this.hosts.library}/library/api/public/items`)
      url.searchParams.set('includeMetadata', 'true')
      url.searchParams.set('platform', 'Windows')
      if (cursor) url.searchParams.set('cursor', cursor)
      const response = await this.auth.fetchAuthenticated(url)
      const body = await readJson<{
        records?: EpicLibraryAsset[]
        responseMetadata?: { nextCursor?: string; stateToken?: string }
      }>(response)
      assets.push(...(body.records ?? []))
      cursor = body.responseMetadata?.nextCursor || undefined
      page++
    } while (cursor && page < 100)
    return assets
  }

  async getPlaytime(accountId: string): Promise<EpicPlaytimeItem[]> {
    const url = `https://${this.hosts.library}/library/api/public/playtime/account/${encodeURIComponent(accountId)}/all`
    const response = await this.auth.fetchAuthenticated(url)
    return readJson<EpicPlaytimeItem[]>(response)
  }

  async getCatalogItem(
    namespace: string,
    catalogItemId: string,
    locale: string,
    country: string
  ): Promise<EpicCatalogItem | null> {
    const url = new URL(
      `https://${this.hosts.catalog}/catalog/api/shared/namespace/${encodeURIComponent(namespace)}/bulk/items`
    )
    url.searchParams.set('id', catalogItemId)
    url.searchParams.set('country', country)
    url.searchParams.set('locale', locale)
    url.searchParams.set('includeMainGameDetails', 'true')
    const response = await this.auth.fetchAuthenticated(url)
    const body = await readJson<Record<string, EpicCatalogItem>>(response)
    return body[catalogItemId] ?? null
  }
}
