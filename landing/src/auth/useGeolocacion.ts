import { useState, useEffect } from 'react'
import { countries, findByISO, type Country } from './countries'

export function useGeolocacion() {
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]!) // Default Ecuador

  useEffect(() => {
    async function detect() {
      try {
        // Usar ipapi.co que es un poco más amigable en planes gratuitos
        const res = await fetch('https://ipapi.co/json/')
        const data = await res.json()
        const detected = findByISO(data.country_code as string)
        if (detected) setSelectedCountry(detected)
      } catch {
        // Fallback silencioso: queda Ecuador por defecto
      }
    }
    detect()
  }, [])

  return { selectedCountry, setSelectedCountry }
}
