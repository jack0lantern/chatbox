// server/lib/plugin-seed.ts

export const bundledPlugins = [
  {
    appSlug: 'chess',
    appName: 'Chess',
    description: 'Play chess against an AI opponent. Supports hints, undo, and redo.',
    iframeUrl: '/plugins/chess/index.html',
    authPattern: 'internal',
    toolSchemas: [
      {
        name: 'start_game',
        description: 'Start a new chess game against the AI',
        parameters: {
          type: 'object',
          properties: {
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'AI difficulty level' },
            color: { type: 'string', enum: ['white', 'black', 'random'], description: 'Which color the student plays' },
          },
          required: ['difficulty', 'color'],
        },
      },
      {
        name: 'get_hint',
        description: 'Suggest the best next move for the student',
        parameters: {
          type: 'object',
          properties: {
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          },
        },
      },
      {
        name: 'end_game',
        description: 'End the current chess game and show results',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'undo_move',
        description: 'Undo the last move',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'redo_move',
        description: 'Redo a previously undone move',
        parameters: { type: 'object', properties: {} },
      },
    ],
    permissions: {
      maxIframeHeight: 600,
      allowedOrigins: ['http://localhost:3000'],
      timeouts: { ready: 10, taskComplete: 30 },
    },
  },
  {
    appSlug: 'timeline',
    appName: 'Timeline Quiz',
    description: 'A history quiz game. Place historical events in chronological order. 3 lives.',
    iframeUrl: '/plugins/timeline/index.html',
    authPattern: 'internal',
    toolSchemas: [
      {
        name: 'start_quiz',
        description: 'Start a new timeline quiz game',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Optional category filter (e.g., space, politics, science)' },
          },
        },
      },
      {
        name: 'check_placement',
        description: 'Check if the student placed the current event card correctly',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'get_hint',
        description: 'Narrow down the correct position for the current card',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'next_card',
        description: 'Draw the next event card',
        parameters: { type: 'object', properties: {} },
      },
    ],
    permissions: {
      maxIframeHeight: 500,
      allowedOrigins: ['http://localhost:3000'],
      timeouts: { ready: 5, taskComplete: 15 },
    },
  },
  {
    appSlug: 'spotify',
    appName: 'Spotify Playlist Creator',
    description: 'Create and manage Spotify playlists from chat',
    iframeUrl: '/plugins/spotify/index.html',
    authPattern: 'external_authenticated',
    oauthProvider: 'spotify',
    toolSchemas: [
      {
        name: 'create_playlist',
        description: 'Create a new Spotify playlist',
        parameters: {
          type: 'object',
          properties: {
            playlistName: { type: 'string', description: 'Name of the playlist' },
            songs: { type: 'array', items: { type: 'string' }, description: 'List of song names to add' },
          },
          required: ['playlistName', 'songs'],
        },
      },
      {
        name: 'search_songs',
        description: 'Search for songs on Spotify',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
      {
        name: 'add_to_playlist',
        description: 'Add songs to an existing playlist',
        parameters: {
          type: 'object',
          properties: {
            playlistId: { type: 'string', description: 'Spotify playlist ID' },
            songs: { type: 'array', items: { type: 'string' }, description: 'Song names to add' },
          },
          required: ['playlistId', 'songs'],
        },
      },
    ],
    permissions: {
      maxIframeHeight: 500,
      allowedOrigins: ['http://localhost:3000'],
      requestedScopes: ['playlist-modify-public'],
      timeouts: { ready: 5, taskComplete: 15 },
    },
  },
]
