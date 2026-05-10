// ── Weather condition icons ───────────────────────────────────────────────
import clearDayUrl from '@meteocons/svg/fill/clear-day.svg?url'
import clearNightUrl from '@meteocons/svg/fill/clear-night.svg?url'
import mostlyClearDayUrl from '@meteocons/svg/fill/mostly-clear-day.svg?url'
import mostlyClearNightUrl from '@meteocons/svg/fill/mostly-clear-night.svg?url'
import partlyCloudyDayUrl from '@meteocons/svg/fill/partly-cloudy-day.svg?url'
import partlyCloudyNightUrl from '@meteocons/svg/fill/partly-cloudy-night.svg?url'
import overcastUrl from '@meteocons/svg/fill/overcast.svg?url'
import overcastNightUrl from '@meteocons/svg/fill/overcast-night.svg?url'
import fogDayUrl from '@meteocons/svg/fill/fog-day.svg?url'
import fogNightUrl from '@meteocons/svg/fill/fog-night.svg?url'
import drizzleUrl from '@meteocons/svg/fill/drizzle.svg?url'
import overcastDrizzleUrl from '@meteocons/svg/fill/overcast-drizzle.svg?url'
import overcastNightDrizzleUrl from '@meteocons/svg/fill/overcast-night-drizzle.svg?url'
import partlyCloudyDayRainUrl from '@meteocons/svg/fill/partly-cloudy-day-rain.svg?url'
import partlyCloudyNightRainUrl from '@meteocons/svg/fill/partly-cloudy-night-rain.svg?url'
import rainUrl from '@meteocons/svg/fill/rain.svg?url'
import overcastRainUrl from '@meteocons/svg/fill/overcast-rain.svg?url'
import overcastNightRainUrl from '@meteocons/svg/fill/overcast-night-rain.svg?url'
import partlyCloudyDaySnowUrl from '@meteocons/svg/fill/partly-cloudy-day-snow.svg?url'
import partlyCloudyNightSnowUrl from '@meteocons/svg/fill/partly-cloudy-night-snow.svg?url'
import snowUrl from '@meteocons/svg/fill/snow.svg?url'
import overcastSnowUrl from '@meteocons/svg/fill/overcast-snow.svg?url'
import overcastNightSnowUrl from '@meteocons/svg/fill/overcast-night-snow.svg?url'
import thunderstormsDayUrl from '@meteocons/svg/fill/thunderstorms-day.svg?url'
import thunderstormsNightUrl from '@meteocons/svg/fill/thunderstorms-night.svg?url'
import thunderstormsDayHailUrl from '@meteocons/svg/fill/thunderstorms-day-hail.svg?url'
import thunderstormsNightHailUrl from '@meteocons/svg/fill/thunderstorms-night-hail.svg?url'
import thermometerUrl from '@meteocons/svg/fill/thermometer.svg?url'

// ── UI / stat icons ───────────────────────────────────────────────────────
import windUrl from '@meteocons/svg/fill/wind.svg?url'
import windAlertUrl from '@meteocons/svg/fill/wind-alert.svg?url'
import humidityUrl from '@meteocons/svg/fill/humidity.svg?url'
import barometerUrl from '@meteocons/svg/fill/barometer.svg?url'
import thermometerSunUrl from '@meteocons/svg/fill/thermometer-sun.svg?url'
import thermometerRaindropUrl from '@meteocons/svg/fill/thermometer-raindrop.svg?url'
import raindropMeasureUrl from '@meteocons/svg/fill/raindrop-measure.svg?url'
import raindropUrl from '@meteocons/svg/fill/raindrop.svg?url'
import uvIndexUrl from '@meteocons/svg/fill/uv-index.svg?url'
import uvIndexAlertUrl from '@meteocons/svg/fill/uv-index-alert.svg?url'
import sunriseUrl from '@meteocons/svg/fill/sunrise.svg?url'
import sunsetUrl from '@meteocons/svg/fill/sunset.svg?url'
import timeAfternoonUrl from '@meteocons/svg/fill/time-afternoon.svg?url'
import compassUrl from '@meteocons/svg/fill/compass.svg?url'
import cloudyUrl from '@meteocons/svg/fill/cloudy.svg?url'

const ICON_URLS = {
  // weather conditions
  'clear-day':               clearDayUrl,
  'clear-night':             clearNightUrl,
  'mostly-clear-day':        mostlyClearDayUrl,
  'mostly-clear-night':      mostlyClearNightUrl,
  'partly-cloudy-day':       partlyCloudyDayUrl,
  'partly-cloudy-night':     partlyCloudyNightUrl,
  'overcast':                overcastUrl,
  'overcast-night':          overcastNightUrl,
  'fog-day':                 fogDayUrl,
  'fog-night':               fogNightUrl,
  'drizzle':                 drizzleUrl,
  'overcast-drizzle':        overcastDrizzleUrl,
  'overcast-night-drizzle':  overcastNightDrizzleUrl,
  'partly-cloudy-day-rain':  partlyCloudyDayRainUrl,
  'partly-cloudy-night-rain':partlyCloudyNightRainUrl,
  'rain':                    rainUrl,
  'overcast-rain':           overcastRainUrl,
  'overcast-night-rain':     overcastNightRainUrl,
  'partly-cloudy-day-snow':  partlyCloudyDaySnowUrl,
  'partly-cloudy-night-snow':partlyCloudyNightSnowUrl,
  'snow':                    snowUrl,
  'overcast-snow':           overcastSnowUrl,
  'overcast-night-snow':     overcastNightSnowUrl,
  'thunderstorms-day':       thunderstormsDayUrl,
  'thunderstorms-night':     thunderstormsNightUrl,
  'thunderstorms-day-hail':  thunderstormsDayHailUrl,
  'thunderstorms-night-hail':thunderstormsNightHailUrl,
  'thermometer':             thermometerUrl,
  // UI / stat icons
  'wind':                    windUrl,
  'wind-alert':              windAlertUrl,
  'humidity':                humidityUrl,
  'barometer':               barometerUrl,
  'thermometer-sun':         thermometerSunUrl,
  'thermometer-raindrop':    thermometerRaindropUrl,
  'raindrop-measure':        raindropMeasureUrl,
  'raindrop':                raindropUrl,
  'uv-index':                uvIndexUrl,
  'uv-index-alert':          uvIndexAlertUrl,
  'sunrise':                 sunriseUrl,
  'sunset':                  sunsetUrl,
  'time-afternoon':          timeAfternoonUrl,
  'compass':                 compassUrl,
  'cloudy':                  cloudyUrl,
}

// Scale factors to normalise visual fill to ~75% of the icon canvas.
// Icons whose artwork already fills ≥74% of the 128×128 canvas get no entry.
const SCALE = {
  // weather conditions
  'clear-night':              1.50,
  'mostly-clear-night':       1.65,
  'mostly-clear-day':         1.17,
  'partly-cloudy-night':      1.21,
  'partly-cloudy-night-rain': 1.21,
  'partly-cloudy-night-snow': 1.21,
  'drizzle':                  1.21,
  'rain':                     1.21,
  'snow':                     1.21,
  'overcast':                 1.15,
  'overcast-night':           1.15,
  'overcast-drizzle':         1.15,
  'overcast-night-drizzle':   1.15,
  'overcast-rain':            1.15,
  'overcast-night-rain':      1.15,
  'overcast-snow':            1.15,
  'overcast-night-snow':      1.15,
  'thunderstorms-night':      1.14,
  'thunderstorms-night-hail': 1.14,
  'thermometer':              1.09,
  // UI icons
  'wind':                     1.19,
  'humidity':                 1.63,
  'raindrop-measure':         1.60,
  'raindrop':                 1.63,
  'cloudy':                   1.21,
}

// Maps day icon names to their night counterparts
const DAY_TO_NIGHT = {
  'clear-day':               'clear-night',
  'mostly-clear-day':        'mostly-clear-night',
  'partly-cloudy-day':       'partly-cloudy-night',
  'overcast':                'overcast-night',
  'fog-day':                 'fog-night',
  'overcast-drizzle':        'overcast-night-drizzle',
  'partly-cloudy-day-rain':  'partly-cloudy-night-rain',
  'overcast-rain':           'overcast-night-rain',
  'partly-cloudy-day-snow':  'partly-cloudy-night-snow',
  'overcast-snow':           'overcast-night-snow',
  'thunderstorms-day':       'thunderstorms-night',
  'thunderstorms-day-hail':  'thunderstorms-night-hail',
}

export function toNightIcon(name) {
  return DAY_TO_NIGHT[name] ?? name
}

export default function WeatherIcon({ name, size = 32, className = '', style = {} }) {
  const src = ICON_URLS[name]
  if (!src) return null
  const scale = SCALE[name]
  return (
    <div
      className={className}
      style={{ width: size, height: size, flexShrink: 0, overflow: 'hidden', ...style }}
    >
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        style={{
          display: 'block',
          transformOrigin: 'center',
          transform: scale ? `scale(${scale})` : undefined,
        }}
        draggable={false}
      />
    </div>
  )
}
