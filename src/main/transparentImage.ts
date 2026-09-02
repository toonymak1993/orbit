import type { NativeImage } from 'electron'

// Keep alpha-bound scanning comfortably below a frame-sized main-thread task.
// Larger images remain valid; they simply retain their original canvas.
const MAX_TRIM_PIXELS = 4_000_000
const ALPHA_THRESHOLD = 10

/**
 * Steam and community wordmarks commonly sit inside a full hero-sized
 * transparent canvas. Cropping only transparent pixels makes the visible logo
 * fill its UI slot without altering its proportions or semantic content.
 */
export function trimTransparentImage(image: NativeImage): NativeImage {
  const { width, height } = image.getSize()
  const pixelCount = width * height
  if (width <= 0 || height <= 0 || pixelCount > MAX_TRIM_PIXELS) return image

  try {
    const bitmap = image.toBitmap()
    if (bitmap.byteLength < pixelCount * 4) return image

    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width * 4
      for (let x = 0; x < width; x++) {
        if (bitmap[rowOffset + x * 4 + 3] <= ALPHA_THRESHOLD) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }

    if (maxX < minX || maxY < minY) return image
    const contentWidth = maxX - minX + 1
    const contentHeight = maxY - minY + 1
    const padding = Math.max(2, Math.ceil(Math.max(contentWidth, contentHeight) * 0.025))
    const x = Math.max(0, minX - padding)
    const y = Math.max(0, minY - padding)
    const cropWidth = Math.min(width - x, contentWidth + padding * 2)
    const cropHeight = Math.min(height - y, contentHeight + padding * 2)
    if (cropWidth >= width * 0.98 && cropHeight >= height * 0.98) return image

    const cropped = image.crop({ x, y, width: cropWidth, height: cropHeight })
    return cropped.isEmpty() ? image : cropped
  } catch {
    return image
  }
}
