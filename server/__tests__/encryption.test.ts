import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from '../lib/encryption'

describe('encryption', () => {
  it('round-trips a string through encrypt and decrypt', () => {
    const plaintext = 'sk-abc123-my-openai-key'
    const encrypted = encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    expect(decrypt(encrypted)).toBe(plaintext)
  })

  it('produces different ciphertext for the same input (random IV)', () => {
    const plaintext = 'sk-abc123'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
  })

  it('handles empty strings', () => {
    const encrypted = encrypt('')
    expect(decrypt(encrypted)).toBe('')
  })
})
