import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getValidSpotifyToken, spotifyFetch } from '@/lib/spotify'
import { recordFailure, recordSuccess } from '@/lib/circuit-breaker'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = (session.user as any).id as string
  const { action, params } = await req.json()

  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  const accessToken = await getValidSpotifyToken(userId)
  if (!accessToken) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  }

  try {
    let result: unknown

    switch (action) {
      case 'search_songs': {
        const q = encodeURIComponent(params.query)
        const response = await spotifyFetch(accessToken, `/search?type=track&q=${q}&limit=20`)
        if (!response.ok) throw new Error(`Spotify API: ${response.status}`)
        const data = await response.json()
        result = data.tracks.items.map((track: any) => ({
          id: track.id,
          name: track.name,
          artist: track.artists.map((a: any) => a.name).join(', '),
          album: track.album.name,
          albumArt: track.album.images[0]?.url ?? null,
          previewUrl: track.preview_url,
          duration: track.duration_ms,
          uri: track.uri,
        }))
        break
      }

      case 'create_playlist': {
        const meRes = await spotifyFetch(accessToken, '/me')
        if (!meRes.ok) throw new Error(`Spotify API: ${meRes.status}`)
        const me = await meRes.json()

        const createRes = await spotifyFetch(
          accessToken,
          `/users/${me.id}/playlists`,
          {
            method: 'POST',
            body: JSON.stringify({ name: params.playlistName, public: true }),
          }
        )
        if (!createRes.ok) throw new Error(`Spotify API: ${createRes.status}`)
        const playlist = await createRes.json()

        if (params.songs?.length) {
          const addRes = await spotifyFetch(
            accessToken,
            `/playlists/${playlist.id}/tracks`,
            {
              method: 'POST',
              body: JSON.stringify({ uris: params.songs }),
            }
          )
          if (!addRes.ok) throw new Error(`Spotify API: ${addRes.status}`)
        }

        result = {
          playlistId: playlist.id,
          playlistUrl: playlist.external_urls.spotify,
          trackCount: params.songs?.length ?? 0,
          coverImageUrl: playlist.images?.[0]?.url ?? null,
        }
        break
      }

      case 'add_to_playlist': {
        const response = await spotifyFetch(
          accessToken,
          `/playlists/${params.playlistId}/tracks`,
          {
            method: 'POST',
            body: JSON.stringify({ uris: params.songs }),
          }
        )
        if (!response.ok) throw new Error(`Spotify API: ${response.status}`)
        result = {
          playlistId: params.playlistId,
          trackCount: params.songs?.length ?? 0,
        }
        break
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

    await recordSuccess('spotify')
    return NextResponse.json({ data: result })
  } catch (error: any) {
    await recordFailure('spotify')
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'UPSTREAM_TIMEOUT' },
        { status: 504 }
      )
    }
    return NextResponse.json(
      { error: 'UPSTREAM_ERROR', message: error.message },
      { status: 502 }
    )
  }
}
