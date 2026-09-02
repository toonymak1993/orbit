import type { GameMetadata } from '@shared/ipc'

type JsonObject = Record<string, unknown>

export interface XboxCatalogGame {
  providerGameId: string
  name: string
  packageFamilyName?: string
  metadata: GameMetadata
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function texts(value: unknown): string[] | undefined {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const values = source.map(text).filter(Boolean) as string[]
  return values.length > 0 ? [...new Set(values)] : undefined
}

function httpsImageUrl(value: unknown): string | undefined {
  const url = text(value)
  if (!url) return undefined
  if (url.startsWith('//')) return `https:${url}`
  return url.startsWith('https://') ? url : undefined
}

interface ImageCandidate {
  url: string
  purpose: string
  width: number
  height: number
}

function imageCandidates(localized: JsonObject): ImageCandidate[] {
  if (!Array.isArray(localized.Images)) return []
  return localized.Images.flatMap((value) => {
    const image = object(value)
    const url = httpsImageUrl(image?.Uri)
    if (!image || !url) return []
    return [{
      url,
      purpose: text(image.ImagePurpose)?.toLowerCase() ?? '',
      width: Math.max(0, Number(image.Width ?? 0)),
      height: Math.max(0, Number(image.Height ?? 0))
    }]
  }).sort((left, right) => right.width * right.height - left.width * left.height)
}

function uniqueUrls(images: ImageCandidate[], purposes: RegExp): string[] | undefined {
  const urls = [...new Set(images.filter((image) => purposes.test(image.purpose)).map((image) => image.url))]
  return urls.length > 0 ? urls : undefined
}

/** Converts Microsoft's public display catalog into ORBIT's provider model. */
export function parseXboxCatalogProducts(
  payload: unknown,
  requestedProductIds: ReadonlySet<string>
): Map<string, XboxCatalogGame> {
  const root = object(payload)
  const products = Array.isArray(root?.Products) ? root.Products : []
  const result = new Map<string, XboxCatalogGame>()

  for (const value of products) {
    const product = object(value)
    const productId = text(product?.ProductId)?.toUpperCase()
    if (
      !product ||
      !productId ||
      !/^[A-Z0-9]{12}$/.test(productId) ||
      !requestedProductIds.has(productId) ||
      text(product.ProductFamily)?.toLowerCase() !== 'games'
    ) {
      continue
    }

    const localized = Array.isArray(product.LocalizedProperties)
      ? object(product.LocalizedProperties[0])
      : undefined
    const properties = object(product.Properties)
    const market = Array.isArray(product.MarketProperties)
      ? object(product.MarketProperties[0])
      : undefined
    const name = text(localized?.ProductTitle) ?? text(localized?.ShortTitle)
    if (!localized || !name) continue

    const images = imageCandidates(localized)
    const vertical = uniqueUrls(images, /poster|brandedkeyart|boxart/)
    const horizontal = uniqueUrls(images, /superheroart|titledheroart|screenshot/)
    const icon = uniqueUrls(images, /boxart|square|icon/)
    const logo = uniqueUrls(images, /logo/)
    const description = text(localized.ShortDescription) ?? text(localized.ProductDescription)
    const developer = text(localized.DeveloperName)
    const publisher = text(localized.PublisherName)
    const packageFamilyName = text(properties?.PackageFamilyName)

    result.set(productId, {
      providerGameId: productId,
      name,
      packageFamilyName,
      metadata: {
        summary: description,
        description,
        genres: texts(properties?.Categories) ?? texts(properties?.Category),
        developers: developer ? [developer] : undefined,
        publishers: publisher ? [publisher] : undefined,
        releaseDateText: text(market?.OriginalReleaseDate),
        platforms: ['windows'],
        storeUrl: `msxbox://game/?productId=${productId}`,
        backgroundUrl: horizontal?.[0],
        storeHeaderUrl: horizontal?.[0],
        iconUrl: icon?.[0],
        artwork: { vertical, horizontal, icon, logo }
      }
    })
  }

  return result
}
