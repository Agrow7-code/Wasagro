import { useState, useEffect } from 'react'
import { countries, findByISO, type Country } from './countries'

export function useGeolocacion() {
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]!) // Default Ecuador

  useEffect(() => {
    async function detect() {
      try {
        const res = await fetch('https://ip-api.com/json')
        const data = await res.json()
        const detected = findByISO(data.countryCode as string)
        if (detected) setSelectedCountry(detected)
      } catch {
        // fallback silencioso: queda Ecuador
      }
    }
    detect()
  }, [])

  return { selectedCountry, setSelectedCountry }
}
