export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  return { x, y }
}

export function tileRangeForBbox([west, south, east, north], z) {
  const nw = lonLatToTile(west, north, z)
  const se = lonLatToTile(east, south, z)
  return {
    minX: Math.floor(Math.min(nw.x, se.x)),
    maxX: Math.floor(Math.max(nw.x, se.x)),
    minY: Math.floor(Math.min(nw.y, se.y)),
    maxY: Math.floor(Math.max(nw.y, se.y)),
  }
}

export function tileToLonLat(x, y, z) {
  const n = 2 ** z
  const lon = (x / n) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)))
  const lat = (latRad * 180) / Math.PI
  return { lon, lat }
}

export function boundsForTileRange(range, z) {
  const nw = tileToLonLat(range.minX, range.minY, z)
  const se = tileToLonLat(range.maxX + 1, range.maxY + 1, z)
  return [nw.lon, se.lat, se.lon, nw.lat]
}

/**
 * Returns the (x0, y0, x1, y1) pixel rectangle within the stitched composite
 * that maps to the Web Mercator tile (z, x, y).
 *
 * The composite was built by fetching all tiles at `baseZoom` within `tileRange`.
 * Pixel (0,0) in the composite = tile (tileRange.minX, tileRange.minY) at baseZoom.
 *
 * scale = 2^(baseZoom - z):  >1 → requested tile is zoomed-out (covers many base tiles)
 *                             <1 → requested tile is zoomed-in (covers fraction of one base tile)
 */
export function tileCropBoundsInComposite(z, x, y, baseZoom, tileRange, tileSize = 256) {
  const scale = 2 ** (baseZoom - z)
  const x0 = (x * scale - tileRange.minX) * tileSize
  const y0 = (y * scale - tileRange.minY) * tileSize
  const x1 = ((x + 1) * scale - tileRange.minX) * tileSize
  const y1 = ((y + 1) * scale - tileRange.minY) * tileSize
  return { x0, y0, x1, y1 }
}
