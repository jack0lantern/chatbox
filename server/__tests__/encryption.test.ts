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

  it('round-trips a long string (simulated real API key)', () => {
    // Simulate a realistic API key like an Anthropic or OpenAI key
    const longKey = 'sk-ant-api03-' + 'A'.repeat(80) + 'AAAA'
    const encrypted = encrypt(longKey)
    expect(encrypted).not.toBe(longKey)
    expect(decrypt(encrypted)).toBe(longKey)
  })

  it('round-trips a string with special characters and unicode', () => {
    const special = 'pàssw0rd!@#$%^&*()_+[]{}|;\':",.<>?/`~ 日本語 🔑 \n\t'
    const encrypted = encrypt(special)
    expect(decrypt(encrypted)).toBe(special)
  })
})
