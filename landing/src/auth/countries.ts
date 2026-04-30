export interface Country {
  name: string
  code: string      // dial code (sin +)
  isoCode: string   // ISO 3166-1 alpha-2
  flag: string
  maxLength: number // dígitos del número LOCAL (sin código de país)
  placeholder: string // ejemplo visual en el input
}

export const countries: Country[] = [
  { name: 'Ecuador',           code: '593', isoCode: 'EC', flag: '🇪🇨', maxLength: 9,  placeholder: '98 765 4321' },
  { name: 'Guatemala',         code: '502', isoCode: 'GT', flag: '🇬🇹', maxLength: 8,  placeholder: '5555 5555'   },
  { name: 'Colombia',          code: '57',  isoCode: 'CO', flag: '🇨🇴', maxLength: 10, placeholder: '310 555 5555' },
  { name: 'México',            code: '52',  isoCode: 'MX', flag: '🇲🇽', maxLength: 10, placeholder: '551 234 5678' },
  { name: 'Perú',              code: '51',  isoCode: 'PE', flag: '🇵🇪', maxLength: 9,  placeholder: '987 654 321' },
  { name: 'Argentina',         code: '54',  isoCode: 'AR', flag: '🇦🇷', maxLength: 11, placeholder: '9 11 2345 6789' },
  { name: 'Chile',             code: '56',  isoCode: 'CL', flag: '🇨🇱', maxLength: 9,  placeholder: '9 8765 4321' },
  { name: 'Bolivia',           code: '591', isoCode: 'BO', flag: '🇧🇴', maxLength: 8,  placeholder: '7123 4567'   },
  { name: 'Costa Rica',        code: '506', isoCode: 'CR', flag: '🇨🇷', maxLength: 8,  placeholder: '8888 8888'   },
  { name: 'Rep. Dominicana',   code: '1',   isoCode: 'DO', flag: '🇩🇴', maxLength: 10, placeholder: '809 555 5555' },
  { name: 'El Salvador',       code: '503', isoCode: 'SV', flag: '🇸🇻', maxLength: 8,  placeholder: '7777 7777'   },
  { name: 'Honduras',          code: '504', isoCode: 'HN', flag: '🇭🇳', maxLength: 8,  placeholder: '9999 9999'   },
  { name: 'Nicaragua',         code: '505', isoCode: 'NI', flag: '🇳🇮', maxLength: 8,  placeholder: '8888 8888'   },
  { name: 'Panamá',            code: '507', isoCode: 'PA', flag: '🇵🇦', maxLength: 8,  placeholder: '6666 6666'   },
  { name: 'Paraguay',          code: '595', isoCode: 'PY', flag: '🇵🇾', maxLength: 9,  placeholder: '981 234 567' },
  { name: 'Uruguay',           code: '598', isoCode: 'UY', flag: '🇺🇾', maxLength: 9,  placeholder: '094 123 456' },
  { name: 'Venezuela',         code: '58',  isoCode: 'VE', flag: '🇻🇪', maxLength: 10, placeholder: '414 123 4567' },
  { name: 'España',            code: '34',  isoCode: 'ES', flag: '🇪🇸', maxLength: 9,  placeholder: '612 345 678' },
  { name: 'Estados Unidos',    code: '1',   isoCode: 'US', flag: '🇺🇸', maxLength: 10, placeholder: '555 555 5555' },
]

/** Busca país por código ISO alpha-2 */
export function findByISO(isoCode: string): Country | undefined {
  return countries.find(c => c.isoCode === isoCode)
}
