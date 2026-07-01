// T-S3.1 — director login redirect (LoginPage.tsx). Drives the real
// StepTelefono -> StepOTP flow end-to-end (no shortcuts) so the test exercises
// the actual switch statement being fixed, not a refactored/extracted helper.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const navigateMock = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

import LoginPage from '../../src/auth/LoginPage'

// Ecuador is the default country (countries[0]) — 9-digit local number.
const PHONE_DIGITS = '987654321'
const OTP_CODE = '123456'

function mockFetchSequence(rol: string) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/auth/request-otp')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (url.endsWith('/auth/verify-otp')) {
      return new Response(
        JSON.stringify({
          user: { id: 'u1', phone: `+593${PHONE_DIGITS}`, rol, nombre: 'Test User' },
          token: 'fake-token',
        }),
        { status: 200 },
      )
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

async function fillPhoneAndSubmit() {
  const phoneInput = screen.getByPlaceholderText('98 765 4321')
  fireEvent.change(phoneInput, { target: { value: PHONE_DIGITS } })
  const submitBtn = screen.getByText('Verificar número →')
  fireEvent.click(submitBtn)
  // Wait for StepOTP to mount (6 single-digit inputs, maxlength=1)
  await waitFor(() => {
    expect(document.querySelectorAll('input[maxlength="1"]').length).toBe(6)
  })
}

async function fillOtp() {
  const otpInputs = Array.from(document.querySelectorAll('input[maxlength="1"]')) as HTMLInputElement[]
  for (let i = 0; i < OTP_CODE.length; i++) {
    fireEvent.change(otpInputs[i]!, { target: { value: OTP_CODE[i] } })
  }
}

describe('LoginPage — director login redirect (T-S3.1)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rol=director → navigates to /admin (not /dashboard/gerente)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence('director'))
    render(<LoginPage />)

    await fillPhoneAndSubmit()
    await fillOtp()

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/admin')
    })
    expect(navigateMock).not.toHaveBeenCalledWith('/dashboard/gerente')
  })

  it('rol=gerente → still navigates to /dashboard/gerente (unchanged)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence('gerente'))
    render(<LoginPage />)

    await fillPhoneAndSubmit()
    await fillOtp()

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/dashboard/gerente')
    })
  })

  it('rol=analista → still navigates to /dashboard/exportadora (unchanged)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence('analista'))
    render(<LoginPage />)

    await fillPhoneAndSubmit()
    await fillOtp()

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/dashboard/exportadora')
    })
  })
})
