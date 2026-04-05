import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma
const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pluginRegistration: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
}))

import { recordFailure, recordSuccess, isReliable } from '@/lib/circuit-breaker'

describe('circuit-breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recordFailure', () => {
    it('increments failureCount', async () => {
      mockUpdate.mockResolvedValueOnce({ failureCount: 1, status: 'active' })

      await recordFailure('chess')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { appSlug: 'chess' },
        data: { failureCount: { increment: 1 } },
        select: { failureCount: true },
      })
    })

    it('sets status to unreliable at threshold', async () => {
      mockUpdate
        .mockResolvedValueOnce({ failureCount: 3 })
        .mockResolvedValueOnce({ status: 'unreliable' })

      await recordFailure('spotify')

      expect(mockUpdate).toHaveBeenCalledTimes(2)
      expect(mockUpdate).toHaveBeenLastCalledWith({
        where: { appSlug: 'spotify' },
        data: { status: 'unreliable' },
      })
    })

    it('does not set unreliable below threshold', async () => {
      mockUpdate.mockResolvedValueOnce({ failureCount: 2 })

      await recordFailure('chess')

      expect(mockUpdate).toHaveBeenCalledTimes(1)
    })
  })

  describe('recordSuccess', () => {
    it('resets failureCount and sets active', async () => {
      mockUpdate.mockResolvedValueOnce({ failureCount: 0, status: 'active' })

      await recordSuccess('spotify')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { appSlug: 'spotify' },
        data: { failureCount: 0, status: 'active' },
      })
    })
  })

  describe('isReliable', () => {
    it('returns true for active plugins', async () => {
      mockFindUnique.mockResolvedValueOnce({ status: 'active' })

      const result = await isReliable('chess')

      expect(result).toBe(true)
    })

    it('returns false for unreliable plugins', async () => {
      mockFindUnique.mockResolvedValueOnce({ status: 'unreliable' })

      const result = await isReliable('spotify')

      expect(result).toBe(false)
    })

    it('returns false for unknown plugins', async () => {
      mockFindUnique.mockResolvedValueOnce(null)

      const result = await isReliable('nonexistent')

      expect(result).toBe(false)
    })
  })
})
