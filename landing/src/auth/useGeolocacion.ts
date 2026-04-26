import { useState, useEffect } from 'react'
import { countries, Country } from './countries'

export function useGeolocacion() {
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]!) // Default Ecuador

  useEffect(() => {
    async function detect() {
      try {
        const res = await fetch('https://ip-api.com/json')
        const data = await res.json()
        
        // Buscar si el código detectado está en nuestra lista (ej: 'GT', 'CO')
        const detected = countries.find(c => {
          if (data.countryCode === 'GT') return c.code === '502'
          if (data.countryCode === 'CO') return c.code === '57'
          if (data.countryCode === 'MX') return c.code === '52'
          if (data.countryCode === 'EC') return c.code === '593'
          return false
        })

        if (detected) setSelectedCountry(detected)
      } catch (err) {
        console.error('Error detectando ubicación:', err)
      }
    }
    detect()
  }, [])

  return { selectedCountry, setSelectedCountry }
}
