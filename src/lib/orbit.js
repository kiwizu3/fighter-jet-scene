const SIZE = 256
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function smoothstep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1)
  return t * t * (3 - 2 * t)
}

const pack = (r, g, b) => 0xff000000 | (b << 16) | (g << 8) | r

function blend(from, to, amount) {
  return pack(
    (from & 255) * (1 - amount) + (to & 255) * amount,
    ((from >>> 8) & 255) * (1 - amount) + ((to >>> 8) & 255) * amount,
    ((from >>> 16) & 255) * (1 - amount) + ((to >>> 16) & 255) * amount,
  )
}

// Cache the shaded sphere so sampling it at render time is just a texture lookup.
let earth
function buildEarth() {
  const texture = new Uint32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    const ny = (y + 0.5) * 2 / SIZE - 1
    for (let x = 0; x < SIZE; x++) {
      const nx = (x + 0.5) * 2 / SIZE - 1
      const distance = nx * nx + ny * ny
      if (distance >= 1) continue
      const nz = Math.sqrt(1 - distance)
      const lon = Math.atan2(nx, nz)
      const lat = Math.asin(ny)
      const detail = Math.sin(lon * 23 + lat * 14) * Math.cos(lat * 31 - lon * 13)
      const terrain = Math.sin(5 * lon + 2 * Math.sin(lat * 4))
        + 0.65 * Math.cos(8 * lat + 3 * lon) + 0.29 * detail
      const land = smoothstep(0.38, 0.49, terrain)
      const shelf = smoothstep(0.19, 0.45, terrain)
      const clouds = Math.sin(19 * lat + 3 * Math.sin(6 * lon + lat))
        + 0.65 * Math.sin(12 * lon - 7 * lat) + 0.4 * detail
      const dry = smoothstep(-0.3, 0.05, lat) * (1 - smoothstep(0.1, 0.5, lat))
      const ocean = blend(pack(13, 61, 130), pack(25, 121, 160), shelf)
      const surface = blend(ocean, blend(pack(56, 109, 63), pack(183, 147, 88), dry), land)
      const ice = smoothstep(0.91, 1.16, Math.abs(lat) + 0.06 * detail)
      const cover = Math.max(ice, smoothstep(0.7, 1.65, clouds) * 0.85)
      const daylight = smoothstep(-0.32, 0.68, nz * 0.75 - nx * 0.58 - ny * 0.31)
      const lit = blend(pack(5, 11, 29), blend(surface, pack(226, 239, 247), cover), daylight)
      texture[y * SIZE + x] = blend(lit, pack(95, 184, 249), (1 - smoothstep(0, 0.31, nz)) * (0.27 + 0.65 * daylight))
    }
  }
  return texture
}

export function orbitOpacity(altitude) {
  return smoothstep(185, 282, altitude)
}

export function drawOrbit(buffer, depth, stride, left, right, top, bottom,
  frameWidth, frameHeight, centerX, centerY, horizon, perspective, yaw, altitude, opacity) {
  earth ??= buildEarth()
  const retreat = smoothstep(210, 490, altitude)
  const size = Math.min(frameWidth, frameHeight)
  const radius = size * (0.43 + 2.15 * (1 - retreat) ** 3)
  const rim = Math.max(1, Math.min(size * 0.035, radius * 0.085))
  const pitchOffset = Number.isFinite(horizon)
    ? clamp(horizon - centerY, -frameHeight * 0.45, frameHeight * 0.45)
    : 0
  const nearLimb = centerY + frameHeight * 0.20 + pitchOffset * 0.62
  const farCenter = centerY + frameHeight * 0.22 + pitchOffset * 0.44
  const planetY = centerY + (nearLimb + radius - centerY) * (1 - retreat)
    + (farCenter - centerY) * retreat
  const globeY = centerY + (planetY - centerY) * perspective
  const outer = radius + rim
  const textureScale = SIZE / (2 * radius)
  const yawShift = Math.round(yaw * size * 0.3)
  const space = pack(4, 7, 17)
  const air = pack(58, 153, 252)
  for (let y = top; y < bottom; y++) {
    const dy = y - globeY
    const ty = Math.floor(dy * textureScale + SIZE / 2)
    for (let x = left, i = y * stride + left; x < right; x++, i++) {
      const dx = x - centerX
      const distance = dx * dx + dy * dy
      const seed = Math.imul(x - Math.round(centerX) + yawShift, 374761393)
        + Math.imul(y - Math.round(centerY), 668265263)
      const star = Math.imul(seed ^ (seed >>> 13), 1274126177) >>> 24
      let pixel = star === 255 ? pack(124, 156, 197) : star === 254 ? pack(56, 74, 106) : space
      if (distance < outer * outer) {
        const tx = Math.floor(dx * textureScale + SIZE / 2)
        const surface = distance < radius * radius && tx >= 0 && tx < SIZE && ty >= 0 && ty < SIZE
          ? earth[ty * SIZE + tx] : 0
        pixel = surface || blend(pixel, air, 0.72 * (1 - smoothstep(radius - 1, outer, Math.sqrt(distance))))
      }
      buffer[i] = opacity === 1 ? pixel : blend(buffer[i], pixel, opacity)
      if (opacity >= 0.8) depth[i] = 1e9
    }
  }
}
