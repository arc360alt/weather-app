

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

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

  const transitionWeights = []
  const transitionShifts = []
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1].gray
    const next = frames[i].gray
    // Prefer the most recent storm motion; older frames matter less.
    const recencyWeight = i === frames.length - 1 ? 4 : i === frames.length - 2 ? 2 : 1
    transitionWeights.push(recencyWeight)
    // Global shift with maxShift=12 (handles fast storms), stride=3 for speed
    const globalShift = estimateShift(prev, next, width, height, 12, 3)
    transitionShifts.push(globalShift)
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const idx = row * cols + col
        const x0 = col * blockSize
        const y0 = row * blockSize
        const weight = blockMean(next, width, x0, y0, blockSize)
        if (weight < 8) continue
        // Constrain block search to ±3px around the per-transition global shift
        // so all blocks remain coherent with the dominant storm motion.
        const shift = estimateShiftRegionSeeded(prev, next, width, height, x0, y0, blockSize, globalShift.dx, globalShift.dy)
        dxField[idx] += shift.dx * weight * recencyWeight
        dyField[idx] += shift.dy * weight * recencyWeight
        weightField[idx] += weight * recencyWeight
      }
    }
  }

  let dominantDx = 0
  let dominantDy = 0
  let dominantWeight = 0
  for (let i = 0; i < transitionShifts.length; i += 1) {
    dominantDx += transitionShifts[i].dx * transitionWeights[i]
    dominantDy += transitionShifts[i].dy * transitionWeights[i]
    dominantWeight += transitionWeights[i]
  }
  if (dominantWeight > 0) {
    dominantDx /= dominantWeight
    dominantDy /= dominantWeight
  }

  for (let i = 0; i < dxField.length; i += 1) {
    const w = weightField[i]
    if (w > 0) {
      dxField[i] /= w
      dyField[i] /= w
    }
  }

  // Weak/empty blocks were previously left at zero motion, which makes parts of
  // the storm field stay pinned in place and look like a leftover trail.
  // Fill those gaps with the average storm motion, then smooth the full field.
  let globalDx = 0
  let globalDy = 0
  let globalCount = 0
  for (let i = 0; i < dxField.length; i += 1) {
    if (weightField[i] <= 0) continue
    globalDx += dxField[i]
    globalDy += dyField[i]
    globalCount += 1
  }
  if (globalCount > 0) {
    globalDx /= globalCount
    globalDy /= globalCount
    for (let i = 0; i < dxField.length; i += 1) {
      if (weightField[i] > 0) continue
      dxField[i] = dominantWeight > 0 ? dominantDx : globalDx
      dyField[i] = dominantWeight > 0 ? dominantDy : globalDy
    }
  }

  // Bias every block toward the dominant recent storm vector so the forecast
  // follows the observed storm heading instead of wandering off-course.
  for (let i = 0; i < dxField.length; i += 1) {
    const localBlend = weightField[i] > 0 ? 0.65 : 0.35
    const globalBlend = 1 - localBlend
    const targetDx = dominantWeight > 0 ? dominantDx : globalDx
    const targetDy = dominantWeight > 0 ? dominantDy : globalDy
    dxField[i] = dxField[i] * localBlend + targetDx * globalBlend
    dyField[i] = dyField[i] * localBlend + targetDy * globalBlend
  }

  // One light blur pass removes abrupt block-to-block motion jumps.
  const smoothedDx = new Float32Array(dxField.length)
  const smoothedDy = new Float32Array(dyField.length)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let sumDx = 0
      let sumDy = 0
      let sumW = 0
      for (let oy = -1; oy <= 1; oy += 1) {
        const rr = row + oy
        if (rr < 0 || rr >= rows) continue
        for (let ox = -1; ox <= 1; ox += 1) {
          const cc = col + ox
          if (cc < 0 || cc >= cols) continue
          const idx = rr * cols + cc
          const w = ox === 0 && oy === 0 ? 4 : 1
          sumDx += dxField[idx] * w
          sumDy += dyField[idx] * w
          sumW += w
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
// Only block *centres* are backtracked (O(cols×rows×N)), not full pixel arrays,
// so this is fast even on slow hardware.
const TEND_BLOCK = 32

function buildTendencyField(historyFrames, width, height, motionField) {
  const n    = historyFrames.length
  const bs   = TEND_BLOCK
  const cols = Math.ceil(width  / bs)
  const rows = Math.ceil(height / bs)
  const deltaField = new Float32Array(cols * rows)

  for (let br = 0; br < rows; br += 1) {
    for (let bc = 0; bc < cols; bc += 1) {
      // Backtrack block centre newest→oldest.
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

      // Sample co-moving block means.
      const means = historyFrames.map((frame, fi) => {
        const sx = clamp(Math.round(lagX[fi] - bs * 0.5), 0, width  - 1)
        const sy = clamp(Math.round(lagY[fi] - bs * 0.5), 0, height - 1)
        return blockMean(frame.gray, width, sx, sy, bs)
      })

      // Linear regression.
      let sx = 0, sy = 0, sxx = 0, sxy = 0
      for (let fi = 0; fi < n; fi += 1) {
        sx += fi; sy += means[fi]; sxx += fi * fi; sxy += fi * means[fi]
      }
      const denom = n * sxx - sx * sx
      if (Math.abs(denom) < 1e-6) continue
      const slope = (n * sxy - sx * sy) / denom
      // Amplify 3× so a 5% trend/step becomes clearly visible in forecast frames.
      deltaField[br * cols + bc] = clamp(slope * 3, -25, 25)
    }
  }

  return { cols, rows, blockSize: bs, deltaField }
}

// Look up the delta at pixel (x, y) using bilinear interpolation across the
// block grid — same approach as motionAt — so there are no hard block edges.
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

// Apply the tendency field to an already-advected RGBA frame.
//
// Shape-only changes — NO brightness/color modification:
//   growing area  (delta > GROW_T):  empty pixels that directly neighbor (4-way)
//                                    a filled pixel are filled with that neighbor's
//                                    exact color.  1-pixel expansion only so there
//                                    are no halos or trails.
//   decaying area (delta < DECAY_T): filled pixels on the boundary (touching at
//                                    least one empty neighbor) are removed.
//                                    Interior pixels are preserved so storms shrink
//                                    inward naturally over multiple steps.
//   stable area   (|delta| small):   pass through unchanged.
//
// Uses hasPrecip mask built from the *source* frame so the expansion pass
// cannot chain (fill → re-read the just-filled pixel as a source).
const GROW_T  =  4   // delta threshold to trigger 1px expansion
const DECAY_T = -4   // delta threshold to trigger boundary erosion
const N4 = [[-1,0],[1,0],[0,-1],[0,1]]

function applyTendency(rgba, width, height, tendencyField) {
  const out = new Uint8Array(rgba)

  // Snapshot of which pixels had precip BEFORE this pass.
  const hasPrecip = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i += 1) {
    if (rgba[i * 4 + 3] > 0) hasPrecip[i] = 1
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const delta = deltaAt(tendencyField, x, y)
      const idx   = y * width + x
      const p     = idx * 4

      if (!hasPrecip[idx]) {
        // ── Empty pixel: expand if strongly growing and directly borders storm ──
        if (delta < GROW_T) continue
        for (let d = 0; d < 4; d += 1) {
          const nx = x + N4[d][0], ny = y + N4[d][1]
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const ni = ny * width + nx
          if (!hasPrecip[ni]) continue
          // Copy neighbor's exact color — no brightness change.
          const np = ni * 4
          out[p]     = rgba[np]
          out[p + 1] = rgba[np + 1]
          out[p + 2] = rgba[np + 2]
          out[p + 3] = rgba[np + 3]
          break
        }
      } else {
        // ── Filled pixel: erode boundary if strongly decaying ──
        if (delta > DECAY_T) continue
        for (let d = 0; d < 4; d += 1) {
          const nx = x + N4[d][0], ny = y + N4[d][1]
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || !hasPrecip[ny * width + nx]) {
            out[p + 3] = 0   // on boundary → remove
            break
          }
        }
      }
    }
  }
  return out
}

function advectRgba(rgba, width, height, motionField, gain = 1, lead = 1) {
  const out = new Uint8Array(rgba.length)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dst4 = (y * width + x) * 4
      const motion = motionAt(motionField, x, y, width, height)
      // Backward warp: sample source for every destination pixel.
      // This avoids the diagonal hole/tearing artifacts from forward splatting.
      const srcX = Math.round(x - motion.dx * lead)
      const srcY = Math.round(y - motion.dy * lead)
      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue

      const src4 = (srcY * width + srcX) * 4
      const a = rgba[src4 + 3]
      if (a <= 2) continue

      // Keep hue stable: apply only mild scalar gain and avoid aggressive clipping.
      out[dst4 + 0] = clamp(Math.round(rgba[src4 + 0] * gain), 0, 255)
      out[dst4 + 1] = clamp(Math.round(rgba[src4 + 1] * gain), 0, 255)
      out[dst4 + 2] = clamp(Math.round(rgba[src4 + 2] * gain), 0, 255)
      out[dst4 + 3] = a
    }
  }

  return out
}

export function buildNowcastFrames({ historyFrames, minutesAhead, stepMinutes }) {
  const last = historyFrames[historyFrames.length - 1]
  const width = last.width
  const height = last.height

  const motionField = buildMotionField(historyFrames, width, height)

  // Per-pixel tendency field: aligned across all N history frames, 8px resolution.
  const tendencyField = buildTendencyField(historyFrames, width, height, motionField)

  let dxSum = 0
  let dySum = 0
  let vectors = 0
  for (let i = 0; i < motionField.dxField.length; i += 1) {
    const dx = motionField.dxField[i]
    const dy = motionField.dyField[i]
    if (dx !== 0 || dy !== 0) {
      dxSum += dx
      dySum += dy
      vectors += 1
    }
  }
  const motion = {
    dxPerStep: vectors ? dxSum / vectors : 0,
    dyPerStep: vectors ? dySum / vectors : 0,
    vectors,
  }

  const frameCount = Math.max(1, Math.floor(minutesAhead / stepMinutes))
  const forecastFrames = []

  // Iterative advection + per-pixel tendency:
  //   • advectRgba moves the storm one step forward
  //   • applyTendency adds/removes pixels based on the observed intensity trend
  //     across all history frames — growing areas get new pixels, decaying areas
  //     lose pixels, and the delta compounds each step.
  let currentRgba = last.rgba
  for (let i = 1; i <= frameCount; i += 1) {
    const advected = advectRgba(currentRgba, width, height, motionField, 1.0, 1)
    const nextRgba = applyTendency(advected, width, height, tendencyField)
    currentRgba = nextRgba

    const nextGray = new Uint8Array(width * height)
    for (let p = 0, j = 0; p < nextRgba.length; p += 4, j += 1) {
      nextGray[j] = nextRgba[p + 3] === 0 ? 0 : Math.max(nextRgba[p], nextRgba[p + 1], nextRgba[p + 2])
    }
    forecastFrames.push({
      index: i - 1,
      minutesAhead: i * stepMinutes,
      validAt: new Date(Date.now() + i * stepMinutes * 60_000).toISOString(),
      width,
      height,
      gray: nextGray,
      rgba: nextRgba,
    })
  }

  return {
    motion,
    latestSourceTime: last.validAt,
    width,
    height,
    frames: forecastFrames,
  }
}
