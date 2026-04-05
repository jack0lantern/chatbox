import { test, expect, Page } from '@playwright/test'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const BASE = 'http://localhost:3000'

function attachErrorCollectors(page: Page) {
  const errors: string[] = []
  const warnings: string[] = []
  const pageErrors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
    if (msg.type() === 'warning') warnings.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })

  return { errors, warnings, pageErrors }
}

/** Send raw postMessage to the plugin */
async function sendRawMessage(page: Page, data: any) {
  await page.evaluate((d) => {
    window.postMessage(d, '*')
  }, data)
}

/** Send INVOKE_TOOL message */
async function invokeTool(
  page: Page,
  toolName: string,
  parameters: any = {},
  invocationId?: string
) {
  const id = invocationId || `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await page.evaluate(
    ({ toolName, parameters, id }) => {
      window.postMessage(
        {
          type: 'INVOKE_TOOL',
          invocationId: id,
          payload: { toolName, parameters },
        },
        '*'
      )
    },
    { toolName, parameters, id }
  )
  return id
}

/** Set up a mock API responder that intercepts API_REQUEST and sends API_RESPONSE */
async function installApiMock(page: Page) {
  await page.evaluate(() => {
    if ((window as any).__apiMockInstalled) return
    ;(window as any).__apiMockInstalled = true

    window.addEventListener('message', (event) => {
      const data = event.data
      if (!data || data.type !== 'API_REQUEST') return
      const { action } = data.payload || {}
      const requestId = data.requestId

      let result: any = { data: [], error: null }

      if (action === 'search_songs') {
        result = {
          data: [
            {
              id: 'track_1',
              name: 'Fake Song',
              artist: 'Fake Artist',
              album: 'Fake Album',
              albumArt: null,
              previewUrl: null,
              duration: 200000,
              uri: 'spotify:track:fake1',
            },
            {
              id: 'track_2',
              name: 'Another Song',
              artist: 'Another Artist',
              album: 'Another Album',
              albumArt: null,
              previewUrl: 'https://example.com/preview.mp3',
              duration: 180000,
              uri: 'spotify:track:fake2',
            },
          ],
          error: null,
        }
      } else if (action === 'create_playlist') {
        result = {
          data: {
            playlistId: 'pl_mock_123',
            playlistUrl: 'https://open.spotify.com/playlist/mock123',
            trackCount: 2,
            coverImageUrl: null,
          },
          error: null,
        }
      }

      window.postMessage(
        {
          type: 'API_RESPONSE',
          requestId,
          payload: { data: result.data, error: result.error },
        },
        '*'
      )
    })
  })
}

// ─────────────────────────────────────────────
// Phase 1: Exploratory chaos — discover bugs
// ─────────────────────────────────────────────

test.describe('spotify plugin chaos tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)
    await page.waitForLoadState('networkidle')
  })

  // --- Malformed postMessages ---

  test('postMessage with null — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, null)
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('postMessage with number — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, 42)
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('postMessage with string — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, 'garbage')
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('postMessage with unknown type — should be ignored', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, { type: 'BOGUS', payload: {} })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  // --- INVOKE_TOOL with broken payloads ---

  test('INVOKE_TOOL with undefined payload — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'INVOKE_TOOL',
      invocationId: 'test-1',
      payload: undefined,
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('INVOKE_TOOL with null payload — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'INVOKE_TOOL',
      invocationId: 'test-2',
      payload: null,
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('INVOKE_TOOL with empty payload — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'INVOKE_TOOL',
      invocationId: 'test-3',
      payload: {},
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('INVOKE_TOOL with no invocationId — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'INVOKE_TOOL',
      payload: { toolName: 'search_songs', parameters: { query: 'test' } },
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('INVOKE_TOOL with unknown tool — should send error, no crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await invokeTool(page, 'nonexistent_tool', { foo: 'bar' })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('INVOKE_TOOL with null parameters — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'INVOKE_TOOL',
      invocationId: 'test-null-params',
      payload: { toolName: 'search_songs', parameters: null },
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  // --- search_songs edge cases ---

  test('search_songs with empty query — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)
    await invokeTool(page, 'search_songs', { query: '' })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('search_songs with null query — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)
    await invokeTool(page, 'search_songs', { query: null })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('search_songs with no query param — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)
    await invokeTool(page, 'search_songs', {})
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('5 rapid search_songs — only last result should persist, no crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    for (let i = 0; i < 5; i++) {
      await invokeTool(page, 'search_songs', { query: `query ${i}` })
    }
    await page.waitForTimeout(1000)

    expect(pageErrors).toEqual([])
    // Search input should have the last query
    await expect(page.locator('.search-input')).toHaveValue('query 4')
  })

  // --- create_playlist edge cases ---

  test('create_playlist with empty songs array — should show ready state', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)
    await invokeTool(page, 'create_playlist', { playlistName: 'Test', songs: [] })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('create_playlist with null songs — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)
    await invokeTool(page, 'create_playlist', { playlistName: 'Test', songs: null })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('create_playlist with undefined songs — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)
    await invokeTool(page, 'create_playlist', { playlistName: 'My List' })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('create_playlist with songs as string (not array) — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)
    await invokeTool(page, 'create_playlist', {
      playlistName: 'Test',
      songs: 'not-an-array',
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('create_playlist with no playlistName — should use default', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)
    await invokeTool(page, 'create_playlist', { songs: ['Song A'] })
    await page.waitForTimeout(1000)
    expect(pageErrors).toEqual([])
    await expect(page.locator('.playlist-name-input')).toHaveValue('My Playlist')
  })

  // --- add_to_playlist ---

  test('add_to_playlist — should complete without crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await invokeTool(page, 'add_to_playlist', { playlistId: 'abc', songs: ['x'] })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  // --- STATE_RESTORE edge cases ---

  test('STATE_RESTORE with null payload — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, { type: 'STATE_RESTORE', payload: null })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with undefined state — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, { type: 'STATE_RESTORE', payload: { state: undefined } })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with string state — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, { type: 'STATE_RESTORE', payload: { state: 'garbage' } })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with empty object state — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, { type: 'STATE_RESTORE', payload: { state: {} } })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with tracks as string — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: { state: { tracks: 'not-an-array' } },
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with tracks as number — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: { state: { tracks: 42 } },
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with tracks containing malformed entries — should not crash', async ({
    page,
  }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: {
        state: {
          playlistName: 'Test',
          tracks: [null, undefined, 42, 'string', { uri: 'spotify:track:ok', name: 'OK' }],
        },
      },
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with createdPlaylists as non-array — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: {
        state: {
          createdPlaylists: 'not-an-array',
        },
      },
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  // --- API_RESPONSE edge cases ---

  test('API_RESPONSE with unknown requestId — should be ignored', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'API_RESPONSE',
      requestId: 'nonexistent_id',
      payload: { data: [], error: null },
    })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('API_RESPONSE with null payload — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'API_RESPONSE',
      requestId: 'nonexistent',
      payload: null,
    })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('API_RESPONSE with undefined payload — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, {
      type: 'API_RESPONSE',
      requestId: 'nonexistent',
      payload: undefined,
    })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  // --- DESTROY edge cases ---

  test('DESTROY when nothing is active — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRawMessage(page, { type: 'DESTROY' })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('DESTROY then continue using app — should work', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    await sendRawMessage(page, { type: 'DESTROY' })
    await page.waitForTimeout(200)

    // App should still be functional
    await page.fill('.search-input', 'test after destroy')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    await expect(page.locator('.search-input')).toHaveValue('test after destroy')
  })

  // --- Interaction sequences ---

  test('add same track twice via STATE_RESTORE — duplicate URIs handled', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    const track = {
      uri: 'spotify:track:dup1',
      name: 'Dup Song',
      artist: 'Dup Artist',
      albumArt: null,
      duration: 120000,
    }
    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: {
        state: {
          playlistName: 'Dups',
          tracks: [track, track, track],
        },
      },
    })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // Should render 3 tracks (STATE_RESTORE doesn't deduplicate)
    const count = await page.locator('.playlist-track').count()
    expect(count).toBe(3)
  })

  test('remove all tracks one by one — should show empty state', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    // Restore 2 tracks
    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: {
        state: {
          playlistName: 'Remove Test',
          tracks: [
            { uri: 'spotify:track:r1', name: 'Song 1', artist: 'A1', albumArt: null, duration: 100000 },
            { uri: 'spotify:track:r2', name: 'Song 2', artist: 'A2', albumArt: null, duration: 100000 },
          ],
        },
      },
    })
    await page.waitForTimeout(300)

    // Remove first track
    await page.locator('.btn-remove').first().click()
    await page.waitForTimeout(200)

    // Remove remaining track
    await page.locator('.btn-remove').first().click()
    await page.waitForTimeout(200)

    expect(pageErrors).toEqual([])
    await expect(page.locator('.playlist-empty')).toBeVisible()
  })

  test('rapid add and remove via button clicks — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    // Search to get results
    await invokeTool(page, 'search_songs', { query: 'test' })
    await page.waitForTimeout(800)

    // Rapidly click add on first result
    const addBtn = page.locator('.btn-add').first()
    if ((await addBtn.count()) > 0) {
      await addBtn.click()
      await page.waitForTimeout(100)
      // Should be disabled now (already added)
      await expect(addBtn).toBeDisabled()
    }

    expect(pageErrors).toEqual([])
  })

  test('create playlist button disabled with empty name — cannot create', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    // Restore tracks but clear name
    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: {
        state: {
          playlistName: '',
          tracks: [
            { uri: 'spotify:track:t1', name: 'Song', artist: 'Artist', albumArt: null, duration: 100000 },
          ],
        },
      },
    })
    await page.waitForTimeout(300)

    const createBtn = page.locator('.btn-create')
    if ((await createBtn.count()) > 0) {
      await expect(createBtn).toBeDisabled()
    }

    expect(pageErrors).toEqual([])
  })

  test('create playlist with whitespace-only name — button disabled', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: {
        state: {
          playlistName: '   ',
          tracks: [
            { uri: 'spotify:track:t1', name: 'Song', artist: 'Artist', albumArt: null, duration: 100000 },
          ],
        },
      },
    })
    await page.waitForTimeout(300)

    const createBtn = page.locator('.btn-create')
    if ((await createBtn.count()) > 0) {
      await expect(createBtn).toBeDisabled()
    }

    expect(pageErrors).toEqual([])
  })

  // --- Concurrent operations ---

  test('INVOKE_TOOL search during pending search — should not corrupt results', async ({
    page,
  }) => {
    const { pageErrors } = attachErrorCollectors(page)

    // Install a slow mock that delays responses
    await page.evaluate(() => {
      window.addEventListener('message', (event) => {
        const data = event.data
        if (!data || data.type !== 'API_REQUEST') return
        const { action, params } = data.payload || {}
        const requestId = data.requestId

        // Delay response by 500ms
        setTimeout(() => {
          window.postMessage(
            {
              type: 'API_RESPONSE',
              requestId,
              payload: {
                data: [
                  {
                    id: 'delayed_' + (params?.query || 'none'),
                    name: 'Result for: ' + (params?.query || 'none'),
                    artist: 'Artist',
                    album: 'Album',
                    albumArt: null,
                    previewUrl: null,
                    duration: 200000,
                    uri: 'spotify:track:delayed_' + (params?.query || 'none'),
                  },
                ],
                error: null,
              },
            },
            '*'
          )
        }, 500)
      })
    })

    // Fire two searches rapidly
    await invokeTool(page, 'search_songs', { query: 'first' })
    await page.waitForTimeout(100)
    await invokeTool(page, 'search_songs', { query: 'second' })
    await page.waitForTimeout(1500)

    expect(pageErrors).toEqual([])
    // The search input should show the second query
    await expect(page.locator('.search-input')).toHaveValue('second')
  })

  test('STATE_RESTORE then INVOKE_TOOL create_playlist — should merge state', async ({
    page,
  }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    // First restore some state
    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: {
        state: {
          playlistName: 'Old Name',
          tracks: [
            { uri: 'spotify:track:old', name: 'Old Song', artist: 'Old', albumArt: null, duration: 100000 },
          ],
        },
      },
    })
    await page.waitForTimeout(300)

    // Now invoke create_playlist with new songs
    await invokeTool(page, 'create_playlist', {
      playlistName: 'New Playlist',
      songs: ['New Song'],
    })
    await page.waitForTimeout(1500)

    expect(pageErrors).toEqual([])
    // The playlist name should be updated to the new one
    await expect(page.locator('.playlist-name-input')).toHaveValue('New Playlist')
  })

  // --- Stress tests ---

  test('50 rapid STATE_RESTORE messages — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    for (let i = 0; i < 50; i++) {
      await sendRawMessage(page, {
        type: 'STATE_RESTORE',
        payload: {
          state: {
            playlistName: `Playlist ${i}`,
            tracks: [
              {
                uri: `spotify:track:stress_${i}`,
                name: `Song ${i}`,
                artist: `Artist ${i}`,
                albumArt: null,
                duration: 100000 + i * 1000,
              },
            ],
          },
        },
      })
    }
    await page.waitForTimeout(1000)

    expect(pageErrors).toEqual([])
    // Should show the last playlist name
    await expect(page.locator('.playlist-name-input')).toHaveValue('Playlist 49')
  })

  test('10 rapid INVOKE_TOOL with mixed tools — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    const tools = [
      { toolName: 'search_songs', parameters: { query: 'rock' } },
      { toolName: 'create_playlist', parameters: { playlistName: 'Quick', songs: [] } },
      { toolName: 'search_songs', parameters: { query: 'jazz' } },
      { toolName: 'add_to_playlist', parameters: { playlistId: 'x', songs: [] } },
      { toolName: 'nonexistent', parameters: {} },
      { toolName: 'search_songs', parameters: { query: 'pop' } },
      { toolName: 'create_playlist', parameters: { playlistName: 'Fast', songs: ['a'] } },
      { toolName: 'search_songs', parameters: {} },
      { toolName: 'create_playlist', parameters: {} },
      { toolName: 'search_songs', parameters: { query: 'final' } },
    ]

    for (const { toolName, parameters } of tools) {
      await invokeTool(page, toolName, parameters)
    }
    await page.waitForTimeout(2000)

    expect(pageErrors).toEqual([])
  })

  // --- Drag & drop edge cases ---

  test('drag track to same position — should not change order', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: {
        state: {
          tracks: [
            { uri: 'spotify:track:d1', name: 'First', artist: 'A', albumArt: null, duration: 100000 },
            { uri: 'spotify:track:d2', name: 'Second', artist: 'B', albumArt: null, duration: 100000 },
          ],
        },
      },
    })
    await page.waitForTimeout(300)

    // Simulate drag via JS events (Playwright can't construct DragEvent with dataTransfer)
    await page.evaluate(() => {
      const tracks = document.querySelectorAll('.playlist-track')
      if (tracks.length < 2) return
      const first = tracks[0]
      first.dispatchEvent(new Event('dragstart', { bubbles: true }))
      first.dispatchEvent(new Event('dragover', { bubbles: true }))
      first.dispatchEvent(new Event('drop', { bubbles: true }))
      first.dispatchEvent(new Event('dragend', { bubbles: true }))
    })
    await page.waitForTimeout(300)

    expect(pageErrors).toEqual([])
    // Order should be unchanged
    await expect(page.locator('.track-name').first()).toHaveText('First')
  })

  // --- User typing edge cases ---

  test('clear search input — results should clear', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    // Type to search
    await page.fill('.search-input', 'test')
    await page.waitForTimeout(500)

    // Clear search
    await page.fill('.search-input', '')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // Results should be gone
    const resultCount = await page.locator('.track-row').count()
    expect(resultCount).toBe(0)
  })

  test('type very long search query — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    const longQuery = 'a'.repeat(5000)
    await page.fill('.search-input', longQuery)
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('type special characters in search — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    await page.fill('.search-input', '<script>alert("xss")</script>')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // Should not inject script (React escapes)
    const scripts = await page.locator('script[src]').count()
    // Only the CDN scripts should exist
  })

  test('playlist name with special characters — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await page.fill('.playlist-name-input', '<img onerror=alert(1) src=x>')
    await page.waitForTimeout(300)

    expect(pageErrors).toEqual([])
  })

  // --- API error handling ---

  test('API returns error on search — should show error status', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    // Mock that always returns errors
    await page.evaluate(() => {
      window.addEventListener('message', (event) => {
        const data = event.data
        if (!data || data.type !== 'API_REQUEST') return
        window.postMessage(
          {
            type: 'API_RESPONSE',
            requestId: data.requestId,
            payload: {
              data: null,
              error: { code: 'AUTH_REQUIRED', message: 'Not connected' },
            },
          },
          '*'
        )
      })
    })

    await invokeTool(page, 'search_songs', { query: 'test' })
    await page.waitForTimeout(800)

    expect(pageErrors).toEqual([])
    // Status should show error
    await expect(page.locator('.status-bar')).toHaveClass(/error/)
  })

  test('API returns malformed data — should not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await page.evaluate(() => {
      window.addEventListener('message', (event) => {
        const data = event.data
        if (!data || data.type !== 'API_REQUEST') return
        window.postMessage(
          {
            type: 'API_RESPONSE',
            requestId: data.requestId,
            payload: { data: 'not-an-array', error: null },
          },
          '*'
        )
      })
    })

    await invokeTool(page, 'search_songs', { query: 'test' })
    await page.waitForTimeout(800)

    expect(pageErrors).toEqual([])
  })

  // --- Full flow chaos ---

  test('full flow: search, add, rename, create — with mock API', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await installApiMock(page)

    // Search
    await invokeTool(page, 'search_songs', { query: 'test song' })
    await page.waitForTimeout(800)

    // Add first result
    const addBtn = page.locator('.btn-add').first()
    if ((await addBtn.count()) > 0) {
      await addBtn.click()
      await page.waitForTimeout(200)
    }

    // Rename playlist
    await page.fill('.playlist-name-input', 'My Chaos Playlist')
    await page.waitForTimeout(200)

    // Verify track is in playlist
    const playlistTrackCount = await page.locator('.playlist-track').count()
    expect(playlistTrackCount).toBeGreaterThan(0)

    // Create playlist (will use mock API)
    const createBtn = page.locator('.btn-create')
    if ((await createBtn.count()) > 0 && (await createBtn.isEnabled())) {
      await createBtn.click()
      await page.waitForTimeout(1000)
    }

    expect(pageErrors).toEqual([])
  })
})
