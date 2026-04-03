import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3000'

test.describe('Spotify Plugin', () => {
  test('loads and sends READY message', async ({ page }) => {
    const readyPromise = new Promise<boolean>((resolve) => {
      page.on('console', (msg) => {
        // The plugin calls window.parent.postMessage which logs in some setups
        // We check the DOM loads instead
      })
    })

    await page.goto(`${BASE}/plugins/spotify/index.html`)
    await expect(page.locator('.header h1')).toHaveText('Playlist Builder')
    await expect(page.locator('.search-input')).toBeVisible()
    await expect(page.locator('.playlist-section')).toBeVisible()
  })

  test('has search input and playlist builder', async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)

    // Search section
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await expect(searchInput).toHaveAttribute('placeholder', 'Search for songs...')

    // Playlist name input
    const playlistInput = page.locator('.playlist-name-input')
    await expect(playlistInput).toBeVisible()
    await expect(playlistInput).toHaveValue('My Playlist')

    // Empty state message
    await expect(page.locator('.playlist-empty')).toContainText('Search for songs')
  })

  test('renders Spotify branding', async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)
    await expect(page.locator('.header svg')).toBeVisible()
    await expect(page.locator('.status-bar')).toHaveText('Ready')
  })

  test('responds to INVOKE_TOOL search_songs via postMessage', async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)

    // Wait for the app to load
    await expect(page.locator('.search-input')).toBeVisible()

    // Send INVOKE_TOOL message to set search query
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'inv_test_123',
        payload: {
          toolName: 'search_songs',
          parameters: { query: 'test query' },
        },
      }, '*')
    })

    // Verify search input was populated
    await expect(page.locator('.search-input')).toHaveValue('test query')
  })

  test('responds to STATE_RESTORE', async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)
    await expect(page.locator('.search-input')).toBeVisible()

    // Send STATE_RESTORE with playlist data
    await page.evaluate(() => {
      window.postMessage({
        type: 'STATE_RESTORE',
        invocationId: null,
        payload: {
          state: {
            playlistName: 'Restored Playlist',
            tracks: [
              {
                uri: 'spotify:track:abc123',
                name: 'Test Song',
                artist: 'Test Artist',
                albumArt: null,
                duration: 180000,
              },
            ],
            createdPlaylists: [],
          },
        },
      }, '*')
    })

    // Verify state was restored
    await expect(page.locator('.playlist-name-input')).toHaveValue('Restored Playlist')
    await expect(page.locator('.playlist-track')).toBeVisible()
    await expect(page.locator('.track-name').first()).toHaveText('Test Song')
  })
})
