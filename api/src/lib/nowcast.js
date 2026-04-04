

import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { cpus } from 'node:os'

// URL of this file — workers re-import the same module to get all compute fns.
const SELF_URL = import.meta.url
// Leave 2 threads for the main event loop + tile fetch/encode concurrency.
const WORKER_COUNT = Math.min(12, Math.max(2, cpus().length - 2))

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

// ── Global shift estimation ───────────────────────────────────────────────────
// Scans a grid of candidate (dx,dy) offsets and picks the one that minimises
// mean absolute difference over all rainy pixels.
// stride controls density of sample pixels (higher = faster, less accurate).
function estimateShift(prev, next, width, height, maxShift = 7, stride = 2) {
  let best = { dx: 0, dy: 0, score: Number.POSITIVE_INFINITY }

  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      let score = 0
      let count = 0

      for (let y = maxShift; y < height - maxShift; y += stride) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        const rowA = y * width
        const rowB = yy * width

        for (let x = maxShift; x < width - maxShift; x += stride) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue

          const a = prev[rowA + x]
          const b = next[rowB + xx]
          if (a < 16 && b < 16) continue

          score += Math.abs(a - b)
          count += 1
        }
      }

      if (count < 500) continue
      const normalized = score / count
      if (normalized < best.score) best = { dx, dy, score: normalized }
    }
  }

  return { dx: best.dx, dy: best.dy }
}

// Long-range shift: compare frames that are `span` steps apart and divide by
// span to get a per-step velocity.  Averaging over a wider time window is
// much more robust to per-frame noise than chaining adjacent pairs alone,
// because the total displacement is larger relative to noise.
// To keep the search fast at large span, use a coarser stride.
function estimateShiftLongRange(prev, next, width, height, span, maxShiftPerStep = 12) {
  // Cap at 20 to avoid O(maxShift²) blowup — 20px/step still covers fast storms.
  const maxShift = Math.min(20, Math.round(span * maxShiftPerStep))
  const stride   = Math.max(4, Math.round(span * 1.5))   // coarser when span is large
  const raw = estimateShift(prev, next, width, height, maxShift, stride)
  return { dx: raw.dx / span, dy: raw.dy / span }
}

function blockMean(gray, width, x0, y0, size) {
  let sum = 0
  let count = 0
  const x1 = Math.min(width, x0 + size)
  const y1 = Math.min((gray.length / width) | 0, y0 + size)
  for (let y = y0; y < y1; y += 1) {
    const row = y * width
    for (let x = x0; x < x1; x += 1) {
      const v = gray[row + x]
      if (v > 10) {
        sum += v
        count += 1
      }
    }
  }
  return count ? sum / count : 0
}

// Constrained block search seeded by the per-transition global shift.
// Each block can only deviate ±radius pixels from the global motion,
// which prevents independent blocks from latching onto different features
// and making a coherent storm appear to split in the forecast.
function estimateShiftRegionSeeded(prev, next, width, height, x0, y0, size, seedDx, seedDy, radius = 3, stride = 3) {
  const centerDx = Math.round(seedDx)
  const centerDy = Math.round(seedDy)
  let best = { dx: centerDx, dy: centerDy, score: Number.POSITIVE_INFINITY, count: 0 }
  const x1 = Math.min(width, x0 + size)
  const y1 = Math.min(height, y0 + size)

  for (let ddy = -radius; ddy <= radius; ddy += 1) {
    const dy = centerDy + ddy
    for (let ddx = -radius; ddx <= radius; ddx += 1) {
      const dx = centerDx + ddx
      let score = 0
      let count = 0

      for (let y = y0; y < y1; y += stride) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        const rowA = y * width
        const rowB = yy * width
        for (let x = x0; x < x1; x += stride) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const a = prev[rowA + x]
          const b = next[rowB + xx]
          if (a < 14 && b < 14) continue
          score += Math.abs(a - b)
          count += 1
        }
      }

      if (count < 12) continue
      const normalized = score / count
      if (normalized < best.score) best = { dx, dy, score: normalized, count }
    }
  }

  return { dx: best.dx, dy: best.dy }
}

function buildMotionField(frames, width, height, blockSize = 128) {
  const cols = Math.ceil(width / blockSize)
  const rows = Math.ceil(height / blockSize)
  const dxField = new Float32Array(cols * rows)
  const dyField = new Float32Array(cols * rows)
  const weightField = new Float32Array(cols * rows)

  if (frames.length < 2) {
    return { cols, rows, blockSize, dxField, dyField }
  }

  // ── Step 1: Dominant motion from all adjacent-pair global shifts ─────────
  // Recent pairs are weighted more heavily (closer to the forecast moment),
  // but all history contributes so one noisy frame doesn't dominate alone.
  const transitionWeights = []
  const transitionShifts  = []
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1].gray
    const next = frames[i].gray
    const recencyWeight = i === frames.length - 1 ? 3 : i === frames.length - 2 ? 2 : 1
    transitionWeights.push(recencyWeight)
    transitionShifts.push(estimateShift(prev, next, width, height, 12, 3))
  }

  // ── Step 2: Long-range estimate across the full history window ───────────
  // Comparing the OLDEST frame to the NEWEST frame gives the total storm
  // displacement over the full time window.  Intermediate-frame noise
  // averages out, so this estimate is more stable than any single adjacent pair.
  // Blend it in with weight equal to the total adjacent-pair weight so it counts
  // as much as "all past pairs combined" — without drowning out recent motion.
  let dominantDx = 0
  let dominantDy = 0
  let dominantWeight = 0
  for (let i = 0; i < transitionShifts.length; i += 1) {
    dominantDx += transitionShifts[i].dx * transitionWeights[i]
    dominantDy += transitionShifts[i].dy * transitionWeights[i]
    dominantWeight += transitionWeights[i]
  }

  if (frames.length >= 3) {
    const span         = frames.length - 1
    const longRange    = estimateShiftLongRange(
      frames[0].gray, frames[frames.length - 1].gray,
      width, height, span,
    )
    // Weight equal to the sum of all adjacent-pair weights.
    const lrWeight = dominantWeight
    dominantDx     = (dominantDx + longRange.dx * lrWeight) / (dominantWeight + lrWeight)
    dominantDy     = (dominantDy + longRange.dy * lrWeight) / (dominantWeight + lrWeight)
    dominantWeight  = dominantWeight + lrWeight
  } else if (dominantWeight > 0) {
    dominantDx /= dominantWeight
    dominantDy /= dominantWeight
  }

  // ── Step 3: Per-block local shifts, seeded by the per-transition global ──
  for (let ti = 0; ti < transitionShifts.length; ti += 1) {
    const prev = frames[ti].gray
    const next = frames[ti + 1].gray
    const recencyWeight = transitionWeights[ti]
    const globalShift   = transitionShifts[ti]

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const idx = row * cols + col
        const x0  = col * blockSize
        const y0  = row * blockSize
        const weight = blockMean(next, width, x0, y0, blockSize)
        if (weight < 8) continue
        const shift = estimateShiftRegionSeeded(
          prev, next, width, height, x0, y0, blockSize,
          globalShift.dx, globalShift.dy,
        )
        dxField[idx] += shift.dx * weight * recencyWeight
        dyField[idx] += shift.dy * weight * recencyWeight
        weightField[idx] += weight * recencyWeight
      }
    }
  }

  // Normalise accumulated block vectors.
  for (let i = 0; i < dxField.length; i += 1) {
    const w = weightField[i]
    if (w > 0) {
      dxField[i] /= w
      dyField[i] /= w
    }
  }

  // ── Step 4: Fill empty/weak blocks with the dominant motion ──────────────
  // Blocks that had no significant reflectivity get the consensus storm vector
  // instead of staying at (0,0), which prevents spurious stationary "halos"
  // in the forecast.
  for (let i = 0; i < dxField.length; i += 1) {
    if (weightField[i] > 0) continue
    dxField[i] = dominantDx
    dyField[i] = dominantDy
  }

  // ── Step 5: Blend every block toward the dominant motion ─────────────────
  // Keeps all blocks coherent with the observed storm heading.
  for (let i = 0; i < dxField.length; i += 1) {
    const localBlend = weightField[i] > 0 ? 0.65 : 0.35
    const globalBlend = 1 - localBlend
    dxField[i] = dxField[i] * localBlend + dominantDx * globalBlend
    dyField[i] = dyField[i] * localBlend + dominantDy * globalBlend
  }

  // ── Step 6: One light smoothing pass over the block grid ─────────────────
  const smoothedDx = new Float32Array(dxField.length)
  const smoothedDy = new Float32Array(dyField.length)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let sumDx = 0, sumDy = 0, sumW = 0
      for (let oy = -1; oy <= 1; oy += 1) {
        const rr = row + oy
        if (rr < 0 || rr >= rows) continue
        for (let ox = -1; ox <= 1; ox += 1) {
          const cc = col + ox
          if (cc < 0 || cc >= cols) continue
          const idx = rr * cols + cc
          const w   = ox === 0 && oy === 0 ? 4 : 1
          sumDx += dxField[idx] * w
          sumDy += dyField[idx] * w
          sumW  += w
        }
      }
      const idx = row * cols + col
      smoothedDx[idx] = sumDx / sumW
      smoothedDy[idx] = sumDy / sumW
    }
  }
  dxField.set(smoothedDx)
  dyField.set(smoothedDy)

  return { cols, rows, blockSize, dxField, dyField }
}

function motionAt(field, x, y, width, height) {
  // Bilinear interpolation across motion blocks removes visible block seams
  // in forecast frames while preserving the same underlying motion field.
  const fx = clamp((x / field.blockSize) - 0.5, 0, field.cols - 1)
  const fy = clamp((y / field.blockSize) - 0.5, 0, field.rows - 1)

  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(field.cols - 1, x0 + 1)
  const y1 = Math.min(field.rows - 1, y0 + 1)

  const tx = fx - x0
  const ty = fy - y0

  const i00 = y0 * field.cols + x0
  const i10 = y0 * field.cols + x1
  const i01 = y1 * field.cols + x0
  const i11 = y1 * field.cols + x1

  const dx0 = field.dxField[i00] * (1 - tx) + field.dxField[i10] * tx
  const dx1 = field.dxField[i01] * (1 - tx) + field.dxField[i11] * tx
  const dy0 = field.dyField[i00] * (1 - tx) + field.dyField[i10] * tx
  const dy1 = field.dyField[i01] * (1 - tx) + field.dyField[i11] * tx

  return {
    dx: dx0 * (1 - ty) + dx1 * ty,
    dy: dy0 * (1 - ty) + dy1 * ty,
  }
}

// ── Lagrangian tendency field ─────────────────────────────────────────────────
//
// For each 32px block, backtrack its centre through the motion field to find
// where that air parcel was in each history frame, then sample blockMean there.
// Linear regression across those N co-moving samples gives the real per-step
// intensity trend — uncontaminated by the storm translating through fixed cells.
//
// Also stores meanField (mean signal level along each Lagrangian path) so the
// caller can distinguish real growing cells (high mean + positive slope) from
// single-frame noise (near-zero mean + small positive slope).
const TEND_BLOCK = 32

function buildTendencyField(historyFrames, width, height, motionField) {
  const n    = historyFrames.length
  const bs   = TEND_BLOCK
  const cols = Math.ceil(width  / bs)
  const rows = Math.ceil(height / bs)
  const deltaField = new Float32Array(cols * rows)
  const meanField  = new Float32Array(cols * rows)

  for (let br = 0; br < rows; br += 1) {
    for (let bc = 0; bc < cols; bc += 1) {
      // Backtrack block centre newest→oldest through motion field.
      let cx = bc * bs + bs * 0.5
      let cy = br * bs + bs * 0.5
      const lagX = [cx], lagY = [cy]
      for (let step = 0; step < n - 1; step += 1) {
        const m = motionAt(motionField,
          clamp(Math.round(cx), 0, width  - 1),
          clamp(Math.round(cy), 0, height - 1),
          width, height)
        cx = clamp(cx - m.dx, 0, width  - 1)
        cy = clamp(cy - m.dy, 0, height - 1)
        lagX.unshift(cx)
        lagY.unshift(cy)
      }

      // Sample co-moving block means across all history frames.
      const means = historyFrames.map((frame, fi) => {
        const sx = clamp(Math.round(lagX[fi] - bs * 0.5), 0, width  - 1)
        const sy = clamp(Math.round(lagY[fi] - bs * 0.5), 0, height - 1)
        return blockMean(frame.gray, width, sx, sy, bs)
      })

      // Mean signal across the full Lagrangian path — used to filter noise.
      meanField[br * cols + bc] = means.reduce((a, b) => a + b, 0) / n

      // Linear regression slope (gray units per step) — no amplification.
      let sx = 0, sy = 0, sxx = 0, sxy = 0
      for (let fi = 0; fi < n; fi += 1) {
        sx += fi; sy += means[fi]; sxx += fi * fi; sxy += fi * means[fi]
      }
      const denom = n * sxx - sx * sx
      if (Math.abs(denom) < 1e-6) continue
      const slope = (n * sxy - sx * sy) / denom
      // Clamp to ±15 gray units/step so a single anomalous frame can't dominate.
      deltaField[br * cols + bc] = clamp(slope, -15, 15)
    }
  }

  return { cols, rows, blockSize: bs, deltaField, meanField }
}

// Bilinear lookup into the tendency delta field.
function deltaAt(field, x, y) {
  const fx = clamp((x / field.blockSize) - 0.5, 0, field.cols - 1)
  const fy = clamp((y / field.blockSize) - 0.5, 0, field.rows - 1)
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = Math.min(field.cols - 1, x0 + 1)
  const y1 = Math.min(field.rows - 1, y0 + 1)
  const tx = fx - x0, ty = fy - y0
  const d00 = field.deltaField[y0 * field.cols + x0]
  const d10 = field.deltaField[y0 * field.cols + x1]
  const d01 = field.deltaField[y1 * field.cols + x0]
  const d11 = field.deltaField[y1 * field.cols + x1]
  const d0  = d00 * (1 - tx) + d10 * tx
  const d1  = d01 * (1 - tx) + d11 * tx
  return d0 * (1 - ty) + d1 * ty
}

// Bilinear lookup into the mean signal field.
function meanAt(field, x, y) {
  const fx = clamp((x / field.blockSize) - 0.5, 0, field.cols - 1)
  const fy = clamp((y / field.blockSize) - 0.5, 0, field.rows - 1)
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = Math.min(field.cols - 1, x0 + 1)
  const y1 = Math.min(field.rows - 1, y0 + 1)
  const tx = fx - x0, ty = fy - y0
  const d00 = field.meanField[y0 * field.cols + x0]
  const d10 = field.meanField[y0 * field.cols + x1]
  const d01 = field.meanField[y1 * field.cols + x0]
  const d11 = field.meanField[y1 * field.cols + x1]
  const d0  = d00 * (1 - tx) + d10 * tx
  const d1  = d01 * (1 - tx) + d11 * tx
  return d0 * (1 - ty) + d1 * ty
}


const GROW_DELTA_THRESH   =  1.5  // slope > 1.5 gray/step → expanding (lowered from 3)
const DECAY_DELTA_THRESH  = -1.5  // slope < -1.5 gray/step → eroding
const MIN_MEAN_FOR_GROWTH = 20   // Lagrangian mean floor for expansion

// ── Connected-component size labeling (4-connectivity, iterative flood fill) ─
// Returns a Uint32Array where each precip pixel holds the pixel-count of its
// connected component.  Empty pixels hold 0.  Used to filter noise specks
// (tiny isolated regions) from the tendency-expansion gate.
// Fixed: O(M) instead of the old O(N×M) back-fill.
// Previously the inner `for j` loop ran once per component: O(components × pixels).
// With many small noise specks (thousands of components) this was 5–50 B iterations.
function buildComponentSizes(hasPrecip, width, height) {
  const compSize   = new Uint32Array(width * height)
  const label      = new Int32Array(width * height).fill(-1)
  const labelSizes = []  // labelSizes[lbl] = pixel count for that component
  let nextLabel    = 0
  const stack      = []

  for (let start = 0; start < width * height; start += 1) {
    if (!hasPrecip[start] || label[start] >= 0) continue
    const lbl = nextLabel++
    labelSizes.push(0)
    label[start] = lbl
    stack.push(start)
    while (stack.length > 0) {
      const i = stack.pop()
      labelSizes[lbl] += 1
      const x = i % width, y = (i / width) | 0
      if (x > 0          && hasPrecip[i - 1]     && label[i - 1]     < 0) { label[i - 1]     = lbl; stack.push(i - 1)     }
      if (x < width - 1  && hasPrecip[i + 1]     && label[i + 1]     < 0) { label[i + 1]     = lbl; stack.push(i + 1)     }
      if (y > 0          && hasPrecip[i - width]  && label[i - width]  < 0) { label[i - width]  = lbl; stack.push(i - width)  }
      if (y < height - 1 && hasPrecip[i + width]  && label[i + width]  < 0) { label[i + width]  = lbl; stack.push(i + width)  }
    }
  }
  // Single O(M) pass — O(1) lookup per pixel.
  for (let j = 0; j < width * height; j += 1) {
    if (label[j] >= 0) compSize[j] = labelSizes[label[j]]
  }
  return compSize
}

// offsetX / offsetY: cumulative pixels the storm has moved since the last
// observed frame.  We subtract this from each pixel's current position before
// sampling the tendency field so we look up where the parcel *came from*
// (in the original frame's coordinate space) rather than its current location.
function applyTendency(rgba, width, height, tendencyField, offsetX = 0, offsetY = 0) {
  const out = new Uint8Array(rgba)

  // Build snapshot masks from the SOURCE frame so fill/erode passes
  // can't chain-react through pixels written in the same pass.
  const hasPrecip  = new Uint8Array(width * height)
  const blockGrow  = new Uint8Array(width * height)
  const blockDecay = new Uint8Array(width * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (rgba[i * 4 + 3] <= 2) continue
      hasPrecip[i] = 1
    }
  }

  // Label connected components so we can filter by region size.
  const compSize = buildComponentSizes(hasPrecip, width, height)
  // Noise specks: any region smaller than this many pixels is never grown.
  // 16 pixels = a 4×4 block — typical radar noise artifacts are 1–4 px.
  const MIN_COMPONENT_PX = 16

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (!hasPrecip[i]) continue
      // Back-project to where this parcel was in the original (t=0) frame.
      const sx = clamp(x - offsetX, 0, width  - 1)
      const sy = clamp(y - offsetY, 0, height - 1)
      const delta = deltaAt(tendencyField, sx, sy)
      const mean  = meanAt(tendencyField, sx, sy)
      // Grow only if: slope is positive, mean signal is sustained, AND
      // the connected region is large enough to be a real storm feature.
      if (delta > GROW_DELTA_THRESH && mean >= MIN_MEAN_FOR_GROWTH && compSize[i] >= MIN_COMPONENT_PX) {
        blockGrow[i] = 1
      } else if (delta < DECAY_DELTA_THRESH) {
        blockDecay[i] = 1
      }
    }
  }

  // ── 1. Erode boundary pixels of decaying regions ──────────────────────────
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (!hasPrecip[i] || !blockDecay[i]) continue
      // Pixel is on the outer boundary if any 4-neighbour is empty.
      if (
        (x === 0           || !hasPrecip[i - 1])      ||
        (x === width  - 1  || !hasPrecip[i + 1])      ||
        (y === 0           || !hasPrecip[i - width])   ||
        (y === height - 1  || !hasPrecip[i + width])
      ) {
        out[i * 4 + 3] = 0
      }
    }
  }

  // ── 2. Expand growing sustained regions into adjacent empty pixels ─────────
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (hasPrecip[i]) continue  // already filled in source — skip

      // Is there an adjacent pixel that has sustained growing precip?
      let srcI = -1
      if (x > 0           && hasPrecip[i - 1]      && blockGrow[i - 1])      srcI = i - 1
      else if (x < width  - 1 && hasPrecip[i + 1]  && blockGrow[i + 1])      srcI = i + 1
      else if (y > 0          && hasPrecip[i-width] && blockGrow[i-width])    srcI = i - width
      else if (y < height - 1 && hasPrecip[i+width] && blockGrow[i+width])   srcI = i + width
      if (srcI < 0) continue

      // Copy the growing neighbour's exact color — no brightness change.
      out[i * 4 + 0] = rgba[srcI * 4 + 0]
      out[i * 4 + 1] = rgba[srcI * 4 + 1]
      out[i * 4 + 2] = rgba[srcI * 4 + 2]
      out[i * 4 + 3] = rgba[srcI * 4 + 3]
    }
  }

  return out
}

// Backward-warp advection: for every destination pixel, look up where it came
// from in the source frame using bilinear alpha interpolation.
// Sub-pixel motions (< 1 px/step) are handled gracefully — the alpha weight
// smoothly transitions at storm boundaries rather than snapping via Math.round.
// Color is taken from the nearest valid neighbour so radar palette stays crisp.
// alphaFade: multiply output alpha by this value (<1) to show forecast uncertainty.
function advectRgba(rgba, width, height, motionField, lead = 1, alphaFade = 1.0) {
  const out = new Uint8Array(rgba.length)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dst4   = (y * width + x) * 4
      const motion = motionAt(motionField, x, y, width, height)
      const srcXf  = x - motion.dx * lead
      const srcYf  = y - motion.dy * lead

      const x0 = Math.floor(srcXf), y0 = Math.floor(srcYf)
      const x1 = x0 + 1,            y1 = y0 + 1
      const tx = srcXf - x0,         ty = srcYf - y0

      // Bilinear alpha — correctly handles sub-pixel storm edges
      const a = (rgba => {
        let sum = 0
        if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) sum += rgba[(y0*width+x0)*4+3] * (1-tx) * (1-ty)
        if (x1 >= 0 && x1 < width && y0 >= 0 && y0 < height) sum += rgba[(y0*width+x1)*4+3] *    tx  * (1-ty)
        if (x0 >= 0 && x0 < width && y1 >= 0 && y1 < height) sum += rgba[(y1*width+x0)*4+3] * (1-tx) *    ty
        if (x1 >= 0 && x1 < width && y1 >= 0 && y1 < height) sum += rgba[(y1*width+x1)*4+3] *    tx  *    ty
        return sum
      })(rgba)
      if (a < 2) continue

      // Color from the bilinear-weighted nearest valid corner — keeps radar hues crisp
      let bestW = -1, srcOff = -1
      const tryCorner = (cx, cy, w) => {
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) return
        const off = (cy * width + cx) * 4
        if (rgba[off + 3] <= 2) return
        if (w > bestW) { bestW = w; srcOff = off }
      }
      tryCorner(x0, y0, (1-tx) * (1-ty))
      tryCorner(x1, y0,    tx  * (1-ty))
      tryCorner(x0, y1, (1-tx) *    ty)
      tryCorner(x1, y1,    tx  *    ty)
      if (srcOff < 0) continue

      out[dst4 + 0] = rgba[srcOff + 0]
      out[dst4 + 1] = rgba[srcOff + 1]
      out[dst4 + 2] = rgba[srcOff + 2]
      out[dst4 + 3] = Math.round(clamp(a, 0, 255) * alphaFade)
    }
  }

  return out
}

// ── Worker message handler ────────────────────────────────────────────────────
// When this module is loaded as a worker thread (!isMainThread), it listens for
// tasks and runs the pure compute functions above.  No HTTP server, no imports
// beyond node builtins — just number-crunching on typed arrays.
if (!isMainThread) {
  parentPort.on('message', ({ id, task, args }) => {
    try {
      // ── motionTransition ────────────────────────────────────────────────────
      // Compute global shift + per-block shifts for one adjacent frame pair.
      // Returns accumulated dxContrib / dyContrib / weightContrib arrays
      // (already multiplied by recencyWeight) for the main thread to sum.
      if (task === 'motionTransition') {
        const { prevGrayBuf, nextGrayBuf, width, height, blockSize, recencyWeight } = args
        const prev  = new Uint8Array(prevGrayBuf)
        const next  = new Uint8Array(nextGrayBuf)
        const cols  = Math.ceil(width / blockSize)
        const rows  = Math.ceil(height / blockSize)
        const globalShift = estimateShift(prev, next, width, height, 12, 3)
        const dxC = new Float32Array(cols * rows)
        const dyC = new Float32Array(cols * rows)
        const wC  = new Float32Array(cols * rows)
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const idx = row * cols + col
            const x0  = col * blockSize, y0 = row * blockSize
            const w   = blockMean(next, width, x0, y0, blockSize)
            if (w < 8) continue
            const shift = estimateShiftRegionSeeded(prev, next, width, height, x0, y0, blockSize, globalShift.dx, globalShift.dy)
            dxC[idx] = shift.dx * w * recencyWeight
            dyC[idx] = shift.dy * w * recencyWeight
            wC[idx]  = w * recencyWeight
          }
        }
        parentPort.postMessage(
          { id, data: { globalShift, dxCBuf: dxC.buffer, dyCBuf: dyC.buffer, wCBuf: wC.buffer } },
          [dxC.buffer, dyC.buffer, wC.buffer],
        )
        return
      }

      // ── longRangeShift ──────────────────────────────────────────────────────
      // Estimate per-step velocity by comparing oldest vs newest frame.
      if (task === 'longRangeShift') {
        const { prevGrayBuf, nextGrayBuf, width, height, span } = args
        const shift = estimateShiftLongRange(
          new Uint8Array(prevGrayBuf), new Uint8Array(nextGrayBuf),
          width, height, span,
        )
        parentPort.postMessage({ id, data: shift })
        return
      }

      // ── computeFrame ────────────────────────────────────────────────────────
      // Advect lastRgba `step` steps forward then apply Lagrangian tendency.
      // lastRgba lives in a SharedArrayBuffer — zero-copy read by all workers.
      if (task === 'computeFrame') {
        const {
          rgbaSab, width, height,
          mfDxBuf, mfDyBuf, mfCols, mfRows, mfBlockSize,
          tfDeltaBuf, tfMeanBuf, tfCols, tfRows, tfBlockSize,
          step, alphaFade, dxPerStep, dyPerStep,
        } = args
        const mf = {
          cols: mfCols, rows: mfRows, blockSize: mfBlockSize,
          dxField: new Float32Array(mfDxBuf),
          dyField: new Float32Array(mfDyBuf),
        }
        const tf = {
          cols: tfCols, rows: tfRows, blockSize: tfBlockSize,
          deltaField: new Float32Array(tfDeltaBuf),
          meanField:  new Float32Array(tfMeanBuf),
        }
        const lastRgba   = new Uint8Array(rgbaSab)
        const alphaCum   = Math.pow(alphaFade, step)
        const advected   = advectRgba(lastRgba, width, height, mf, step, alphaCum)
        const nextRgba   = applyTendency(advected, width, height, tf,
          Math.round(dxPerStep * step), Math.round(dyPerStep * step))
        const nextGray   = new Uint8Array(width * height)
        for (let p = 0, j = 0; p < nextRgba.length; p += 4, j += 1) {
          nextGray[j] = nextRgba[p + 3] === 0
            ? 0 : Math.max(nextRgba[p], nextRgba[p + 1], nextRgba[p + 2])
        }
        parentPort.postMessage(
          { id, data: { rgbaBuf: nextRgba.buffer, grayBuf: nextGray.buffer } },
          [nextRgba.buffer, nextGray.buffer],
        )
        return
      }

      parentPort.postMessage({ id, error: `unknown task: ${task}` })
    } catch (err) {
      parentPort.postMessage({ id, error: err.message })
    }
  })
}

// ── Worker pool (main thread only) ────────────────────────────────────────────
let   _pool      = null
let   _nextJobId = 0
const _pending   = new Map()

function getPool() {
  if (_pool) return _pool
  const workers = [], idle = [], queue = []
  _pool = { workers, idle, queue }

  for (let i = 0; i < WORKER_COUNT; i += 1) {
    const w = new Worker(new URL(SELF_URL), { type: 'module' })
    w.on('error', e => console.error('[nowcast worker]', e))
    w.on('message', ({ id, data, error }) => {
      const job = _pending.get(id)
      if (!job) return
      _pending.delete(id)
      if (error) job.reject(new Error(error))
      else       job.resolve(data)

      if (queue.length > 0) {
        const next = queue.shift()
        _pending.set(next.id, next)
        w.postMessage({ id: next.id, task: next.task, args: next.args }, next.tl)
      } else {
        idle.push(w)
      }
    })
    workers.push(w)
    idle.push(w)
  }

  process.once('exit', () => { for (const w of workers) w.terminate() })
  console.log(`[nowcast] worker pool ready — ${WORKER_COUNT} threads`)
  return _pool
}

function runOnWorker(task, args, tl = []) {
  const pool = getPool()
  const id   = ++_nextJobId
  return new Promise((resolve, reject) => {
    if (pool.idle.length > 0) {
      const w = pool.idle.pop()
      _pending.set(id, { id, resolve, reject })
      w.postMessage({ id, task, args }, tl)
    } else {
      pool.queue.push({ id, task, args, tl, resolve, reject })
    }
  })
}

// ── Parallel buildNowcastFrames ───────────────────────────────────────────────
export async function buildNowcastFrames({ historyFrames, minutesAhead, stepMinutes }) {
  const last    = historyFrames[historyFrames.length - 1]
  const { width, height } = last
  const blockSize = 128
  const mfCols    = Math.ceil(width  / blockSize)
  const mfRows    = Math.ceil(height / blockSize)

  // ── Phase 1: All transition shifts in parallel ──────────────────────────────
  // Each transition pair runs in its own worker: global estimateShift + all
  // per-block estimateShiftRegionSeeded.  The long-range estimate (frames[0]→[N])
  // runs concurrently as a 6th worker task.
  const recencyWeights = []
  const adjTasks = []
  for (let i = 1; i < historyFrames.length; i += 1) {
    const rw = i === historyFrames.length - 1 ? 3 : i === historyFrames.length - 2 ? 2 : 1
    recencyWeights.push(rw)
    // Copy gray buffers: each worker needs its own (frames are shared across transitions).
    const prevBuf = historyFrames[i - 1].gray.slice().buffer
    const nextBuf = historyFrames[i].gray.slice().buffer
    adjTasks.push(runOnWorker(
      'motionTransition',
      { prevGrayBuf: prevBuf, nextGrayBuf: nextBuf, width, height, blockSize, recencyWeight: rw },
      [prevBuf, nextBuf],
    ))
  }

  const lrTask = historyFrames.length >= 3
    ? runOnWorker('longRangeShift', {
        prevGrayBuf: historyFrames[0].gray.slice().buffer,
        nextGrayBuf: historyFrames[historyFrames.length - 1].gray.slice().buffer,
        width, height, span: historyFrames.length - 1,
      })
    : Promise.resolve({ dx: 0, dy: 0 })

  const [adjResults, lrShift] = await Promise.all([Promise.all(adjTasks), lrTask])

  // ── Aggregate motion field ──────────────────────────────────────────────────
  const dxField     = new Float32Array(mfCols * mfRows)
  const dyField     = new Float32Array(mfCols * mfRows)
  const weightField = new Float32Array(mfCols * mfRows)
  let   dominantDx = 0, dominantDy = 0, dominantWeight = 0

  for (let ti = 0; ti < adjResults.length; ti += 1) {
    const { globalShift, dxCBuf, dyCBuf, wCBuf } = adjResults[ti]
    const dxC = new Float32Array(dxCBuf)
    const dyC = new Float32Array(dyCBuf)
    const wC  = new Float32Array(wCBuf)
    const rw  = recencyWeights[ti]
    dominantDx     += globalShift.dx * rw
    dominantDy     += globalShift.dy * rw
    dominantWeight += rw
    for (let i = 0; i < mfCols * mfRows; i += 1) {
      dxField[i]     += dxC[i]
      dyField[i]     += dyC[i]
      weightField[i] += wC[i]
    }
  }

  // Blend long-range estimate 50/50 with adjacent-pair aggregate.
  if (historyFrames.length >= 3 && dominantWeight > 0) {
    dominantDx = (dominantDx / dominantWeight + lrShift.dx) / 2
    dominantDy = (dominantDy / dominantWeight + lrShift.dy) / 2
  } else if (dominantWeight > 0) {
    dominantDx /= dominantWeight
    dominantDy /= dominantWeight
  }

  // Normalise, fill empty blocks, blend toward dominant, light smooth.
  for (let i = 0; i < dxField.length; i += 1) {
    if (weightField[i] > 0) { dxField[i] /= weightField[i]; dyField[i] /= weightField[i] }
    else                    { dxField[i] = dominantDx;       dyField[i] = dominantDy      }
  }
  for (let i = 0; i < dxField.length; i += 1) {
    const lb = weightField[i] > 0 ? 0.65 : 0.35
    dxField[i] = dxField[i] * lb + dominantDx * (1 - lb)
    dyField[i] = dyField[i] * lb + dominantDy * (1 - lb)
  }
  const sdx = new Float32Array(dxField.length), sdy = new Float32Array(dyField.length)
  for (let row = 0; row < mfRows; row += 1) {
    for (let col = 0; col < mfCols; col += 1) {
      let sx = 0, sy = 0, sw = 0
      for (let oy = -1; oy <= 1; oy += 1) {
        const rr = row + oy; if (rr < 0 || rr >= mfRows) continue
        for (let ox = -1; ox <= 1; ox += 1) {
          const cc = col + ox; if (cc < 0 || cc >= mfCols) continue
          const idx = rr * mfCols + cc, w = (ox === 0 && oy === 0) ? 4 : 1
          sx += dxField[idx] * w; sy += dyField[idx] * w; sw += w
        }
      }
      const idx = row * mfCols + col; sdx[idx] = sx / sw; sdy[idx] = sy / sw
    }
  }
  dxField.set(sdx); dyField.set(sdy)

  const motionField = { cols: mfCols, rows: mfRows, blockSize, dxField, dyField }
  let dxSum = 0, dySum = 0, vectors = 0
  for (let i = 0; i < dxField.length; i += 1) {
    if (dxField[i] !== 0 || dyField[i] !== 0) { dxSum += dxField[i]; dySum += dyField[i]; vectors += 1 }
  }
  const motion = {
    dxPerStep: vectors ? dxSum / vectors : 0,
    dyPerStep: vectors ? dySum / vectors : 0,
    vectors,
  }

  // ── Phase 2: Tendency field (sync, fast ~100ms) ─────────────────────────────
  const tendencyField = buildTendencyField(historyFrames, width, height, motionField)

  // ── Phase 3: All forecast frames in parallel ────────────────────────────────
  // Each frame independently advects lastRgba with lead=step, so all 12 can run
  // simultaneously across the worker pool.  lastRgba is a SharedArrayBuffer so
  // workers read it with zero copies.
  const rgbaSab    = new SharedArrayBuffer(last.rgba.byteLength)
  new Uint8Array(rgbaSab).set(last.rgba)
  // Motion + tendency fields are small — copy to each worker via postMessage.
  const mfDxBuf    = dxField.buffer.slice(0)
  const mfDyBuf    = dyField.buffer.slice(0)
  const tfDeltaBuf = tendencyField.deltaField.buffer.slice(0)
  const tfMeanBuf  = tendencyField.meanField.buffer.slice(0)

  const frameCount  = Math.max(1, Math.floor(minutesAhead / stepMinutes))
  const ALPHA_FADE  = 0.97
  const frameTasks  = Array.from({ length: frameCount }, (_, fi) => {
    const step = fi + 1
    return runOnWorker('computeFrame', {
      rgbaSab,
      width, height,
      mfDxBuf:   mfDxBuf.slice(0),
      mfDyBuf:   mfDyBuf.slice(0),
      mfCols, mfRows, mfBlockSize: blockSize,
      tfDeltaBuf: tfDeltaBuf.slice(0),
      tfMeanBuf:  tfMeanBuf.slice(0),
      tfCols: tendencyField.cols, tfRows: tendencyField.rows, tfBlockSize: tendencyField.blockSize,
      step, alphaFade: ALPHA_FADE,
      dxPerStep: motion.dxPerStep, dyPerStep: motion.dyPerStep,
    })
  })

  const frameResults = await Promise.all(frameTasks)
  const forecastFrames = frameResults.map((res, fi) => ({
    index:        fi,
    minutesAhead: (fi + 1) * stepMinutes,
    validAt:      new Date(Date.now() + (fi + 1) * stepMinutes * 60_000).toISOString(),
    width,
    height,
    gray: new Uint8Array(res.grayBuf),
    rgba: new Uint8Array(res.rgbaBuf),
  }))

  return {
    motion,
    latestSourceTime: last.validAt,
    width,
    height,
    frames: forecastFrames,
  }
}

