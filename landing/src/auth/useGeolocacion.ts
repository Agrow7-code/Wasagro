import { useState, useEffect } from 'react'
import { countries, type Country } from './countries'

export function useGeolocacion() {
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]!) // Default Ecuador (index 0)

  useEffect(() => {
    // Detección de IP desactivada temporalmente para evitar errores 403/504 en el frontend
    // El sistema usará Ecuador como país predeterminado
  }, [])

  return { selectedCountry, setSelectedCountry }
}
