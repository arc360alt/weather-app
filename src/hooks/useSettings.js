import { useState, useEffect, useCallback } from 'react'
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../config/defaults'

/**
 * useSettings — persists weather app settings to localStorage.
 * Returns [settings, updateSettings, resetSettings]
 */
export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        // Merge stored with defaults so new keys are always present
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      }
    } catch (e) {
      console.warn('Failed to load settings from localStorage:', e)
    }
    return DEFAULT_SETTINGS
  })

  // Persist every change to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e)
    }
  }, [settings])

  const updateSettings = useCallback((patch) => {
    setSettings(prev => ({ ...prev, ...patch }))
  }, [])

  const resetSettings = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setSettings(DEFAULT_SETTINGS)
  }, [])

  return [settings, updateSettings, resetSettings]
}
