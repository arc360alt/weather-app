// Default application configuration
export const DEFAULT_SETTINGS = {
  // Location
  lat: 40.71,
  lon: -74.01,
  locationName: 'New York, NY',

  // Map appearance
  mapStyle: 'streets-v2', // Options: streets-v2, satellite, topo-v2, backdrop, ocean
  weatherLayer: 'radar',  // Options: radar, wind, precipitation, temperature, pressure
  layerOpacity: 0.7,

  // Radar animation
  animateRadar: true,
  animationSpeed: 3, // 1=slow, 3=normal, 6=fast

  // Units
  units: 'metric', // 'metric' | 'imperial'

  // UI preferences
  panelPosition: 'left',   // 'left' | 'right'
  showHourlyChart: true,
  showDailyForecast: true,
  show7DayChart: false,
  darkMode: true,
  showRadarBar: true,

  // Chart preferences
  chartType: 'temperature', // 'temperature' | 'precipitation' | 'wind'

  // Weather provider
  weatherProvider: 'openmeteo',  // 'openmeteo' | 'openweathermap'
  owmApiKey: '',
  radarProvider: 'maptiler',
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

// Weather code to human-readable description + icon mapping
export const WEATHER_CODES = {
  0:  { label: 'Clear Sky',         icon: '☀️' },
  1:  { label: 'Mainly Clear',      icon: '🌤️' },
  2:  { label: 'Partly Cloudy',     icon: '⛅' },
  3:  { label: 'Overcast',          icon: '☁️' },
  45: { label: 'Foggy',             icon: '🌫️' },
  48: { label: 'Icy Fog',           icon: '🌫️' },
  51: { label: 'Light Drizzle',     icon: '🌦️' },
  53: { label: 'Drizzle',           icon: '🌦️' },
  55: { label: 'Heavy Drizzle',     icon: '🌧️' },
  61: { label: 'Light Rain',        icon: '🌧️' },
  63: { label: 'Rain',              icon: '🌧️' },
  65: { label: 'Heavy Rain',        icon: '🌧️' },
  71: { label: 'Light Snow',        icon: '🌨️' },
  73: { label: 'Snow',              icon: '❄️' },
  75: { label: 'Heavy Snow',        icon: '❄️' },
  77: { label: 'Snow Grains',       icon: '🌨️' },
  80: { label: 'Light Showers',     icon: '🌦️' },
  81: { label: 'Showers',           icon: '🌧️' },
  82: { label: 'Heavy Showers',     icon: '⛈️' },
  85: { label: 'Snow Showers',      icon: '🌨️' },
  86: { label: 'Heavy Snow Showers',icon: '❄️' },
  95: { label: 'Thunderstorm',      icon: '⛈️' },
  96: { label: 'Thunderstorm + Hail',icon: '⛈️' },
  99: { label: 'Heavy Thunderstorm',icon: '⛈️' },
}

export const RADAR_PROVIDERS = [
  { label: 'MapTiler',   value: 'maptiler' },
  { label: 'RainViewer', value: 'rainviewer' },
  { label: 'NEXRAD',     value: 'nexrad' },
]

export const STORAGE_KEY = 'weather-app-settings'