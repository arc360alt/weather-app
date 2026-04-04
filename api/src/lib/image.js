import sharp from 'sharp'

export async function decodePng(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), width: info.width, height: info.height }
}

export function pngToGray(data) {
  const gray = new Uint8Array((data.length / 4) | 0)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    if (a === 0) {
      gray[j] = 0
      continue
    }
    gray[j] = Math.max(r, g, b)
  }
  return gray
}

export function composeTileGrid(tileGrid, cols, rows, tileSize) {
  const width = cols * tileSize
  const height = rows * tileSize
  const rgba = new Uint8Array(width * height * 4)
  const gray = new Uint8Array(width * height)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const idx = row * cols + col
      const tile = tileGrid[idx]
      if (!tile) continue
      const srcGray = tile.gray
      const srcRgba = tile.rgba
      for (let y = 0; y < tileSize; y += 1) {
        const dstBase = (row * tileSize + y) * width + (col * tileSize)
        const srcBase = y * tileSize
        const dstBase4 = dstBase * 4
        const srcBase4 = srcBase * 4
        gray.set(srcGray.subarray(srcBase, srcBase + tileSize), dstBase)
        rgba.set(srcRgba.subarray(srcBase4, srcBase4 + (tileSize * 4)), dstBase4)
      }
    }
  }

  return { rgba, gray, width, height }
}

export function meanRain(gray, threshold = 20) {
  let sum = 0
  let count = 0
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i]
    if (v >= threshold) {
      sum += v
      count += 1
    }
  }
  return count === 0 ? 0 : sum / count
}

/**
 * Crop any WebMercator tile rectangle from an RGBA composite and encode as
 * a 256x256 PNG.  Preserves source colors (no grayscale recoloring).
 */
export async function cropAndEncodeTile(rgba, srcWidth, srcHeight, { x0, y0, x1, y1 }, tileSize = 256) {
  const ix0 = Math.floor(x0)
  const iy0 = Math.floor(y0)
  const ix1 = Math.ceil(x1)
  const iy1 = Math.ceil(y1)

  const outW = Math.max(1, ix1 - ix0)
  const outH = Math.max(1, iy1 - iy0)
  const canvas = new Uint8Array(outW * outH * 4)

  const srcX0 = Math.max(0, ix0)
  const srcY0 = Math.max(0, iy0)
  const srcX1 = Math.min(srcWidth, ix1)
  const srcY1 = Math.min(srcHeight, iy1)

  if (srcX1 > srcX0 && srcY1 > srcY0) {
    const dstX = srcX0 - ix0
    const dstY = srcY0 - iy0
    const copyW = srcX1 - srcX0
    const copyBytes = copyW * 4

    for (let y = 0; y < (srcY1 - srcY0); y += 1) {
      const srcRowStart = ((srcY0 + y) * srcWidth + srcX0) * 4
      const dstRowStart = (((dstY + y) * outW) + dstX) * 4
      canvas.set(rgba.subarray(srcRowStart, srcRowStart + copyBytes), dstRowStart)
    }
  }

  return sharp(Buffer.from(canvas), {
    raw: { width: outW, height: outH, channels: 4 },
  })
    .resize(tileSize, tileSize, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 3 })
    .toBuffer()
}

export async function encodeRgbaPng(rgba, width, height) {
  return sharp(Buffer.from(rgba), {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 3 })
    .toBuffer()
}
