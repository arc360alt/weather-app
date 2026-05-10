// Default application configuration
export const DEFAULT_SETTINGS = {
  // Location
  lat: 41.8781,
  lon: 87.6298,
  locationName: 'Chicago, IL',

  // Map appearance
  mapStyle: 'satellite', // Options: streets-v2, satellite, topo-v2, backdrop, ocean
  weatherLayer: 'radar',  // Options: radar, wind, precipitation, temperature, pressure
  layerOpacity: 0.7,
  warningLayerOpacity: 0.35,

  // Radar animation
  animateRadar: false,
  animationSpeed: 3, // 1=slow, 3=normal, 6=fast
  radarMode: 'reflectivity', // 'reflectivity' | 'velocity'
  showNwsWarnings: false,

  // Units
  units: 'imperial', // 'metric' | 'imperial'

  // UI preferences
  panelPosition: 'left',   // 'left' | 'right'
  showHourlyChart: true,
  showDailyForecast: true,
  show7DayChart: true,
  darkMode: true,
  showRadarBar: true,

  // Chart preferences
  chartType: 'temperature', // 'temperature' | 'precipitation' | 'wind'

  // Weather provider
  weatherProvider: 'nws',  // 'openmeteo' | 'openweathermap'
  owmApiKey: '',
  radarProvider: 'rainviewer',
}

export const MAP_STYLES = [
  { label: 'Streets',   value: 'streets-v2' },
  { label: 'Satellite', value: 'satellite' },
  { label: 'Topo',      value: 'topo-v2' },
  { label: 'Dark',      value: 'backdrop' },
  { label: 'Ocean',     value: 'ocean' },
]

export const WEATHER_LAYERS = [
  { label: 'Radar',         value: 'radar' },
  { label: 'Wind',          value: 'wind' },
  { label: 'Precipitation', value: 'precipitation' },
  { label: 'Temperature',   value: 'temperature' },
  { label: 'Pressure',      value: 'pressure' },
]

export const ANIMATION_SPEEDS = [
  { label: 'Slow',   value: 1 },
  { label: 'Normal', value: 3 },
  { label: 'Fast',   value: 6 },
]

export const WEATHER_PROVIDERS = [
  { label: 'Open-Meteo (free, no key)', value: 'openmeteo' },
  { label: 'OpenWeatherMap',            value: 'openweathermap' },
]

// Weather code to human-readable description + meteocon icon name mapping
export const WEATHER_CODES = {
  0:  { label: 'Clear Sky',            icon: 'clear-day' },
  1:  { label: 'Mainly Clear',         icon: 'mostly-clear-day' },
  2:  { label: 'Partly Cloudy',        icon: 'partly-cloudy-day' },
  3:  { label: 'Overcast',             icon: 'overcast' },
  45: { label: 'Foggy',                icon: 'fog-day' },
  48: { label: 'Icy Fog',              icon: 'fog-day' },
  51: { label: 'Light Drizzle',        icon: 'drizzle' },
  53: { label: 'Drizzle',              icon: 'drizzle' },
  55: { label: 'Heavy Drizzle',        icon: 'overcast-drizzle' },
  61: { label: 'Light Rain',           icon: 'partly-cloudy-day-rain' },
  63: { label: 'Rain',                 icon: 'rain' },
  65: { label: 'Heavy Rain',           icon: 'overcast-rain' },
  71: { label: 'Light Snow',           icon: 'partly-cloudy-day-snow' },
  73: { label: 'Snow',                 icon: 'snow' },
  75: { label: 'Heavy Snow',           icon: 'overcast-snow' },
  77: { label: 'Snow Grains',          icon: 'snow' },
  80: { label: 'Light Showers',        icon: 'partly-cloudy-day-rain' },
  81: { label: 'Showers',              icon: 'rain' },
  82: { label: 'Heavy Showers',        icon: 'overcast-rain' },
  85: { label: 'Snow Showers',         icon: 'partly-cloudy-day-snow' },
  86: { label: 'Heavy Snow Showers',   icon: 'overcast-snow' },
  95: { label: 'Thunderstorm',         icon: 'thunderstorms-day' },
  96: { label: 'Thunderstorm + Hail',  icon: 'thunderstorms-day-hail' },
  99: { label: 'Heavy Thunderstorm',   icon: 'thunderstorms-day' },
}

export const RADAR_PROVIDERS = [
  { label: 'MapTiler',   value: 'maptiler' },
  { label: 'StormCast', value: 'rainviewer' },
  { label: 'NEXRAD',     value: 'nexrad' },
]

export const STORAGE_KEY = 'weather-app-settings-v2'