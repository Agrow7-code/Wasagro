import { describe, expect, it } from 'vitest'
import { maskPhone } from '../../src/utils/maskPhone.js'

describe('maskPhone', () => {
  it('masks a phone with >=4 chars to **** + last 4 digits', () => {
    expect(maskPhone('593987654321')).toBe('****4321')
  })

  it('returns **** for a phone with fewer than 4 chars', () => {
    expect(maskPhone('12')).toBe('****')
  })

  it('returns **** for an empty string', () => {
    expect(maskPhone('')).toBe('****')
  })
})
