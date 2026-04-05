// server/lib/plugin-seed.ts

export const bundledPlugins = [
  {
    appSlug: 'chess',
    appName: 'Chess',
    description:
      'Chess coaching plugin. Students play in the embedded board. For position-aware teaching — openings, plans, or what to think about next — call get_game_state first so your advice is grounded in the actual position. For explicit engine help (best move), use get_hint instead. Use start_game to begin a session, end_game to close it, and undo_move / redo_move to step through move history.',
    iframeUrl: '/plugins/chess/index.html',
    authPattern: 'internal',
    toolSchemas: [
      {
        name: 'start_game',
        description: 'Start a new chess game; does not return position data for coaching (use get_game_state after the game begins).',
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
        name: 'get_game_state',
        description:
          'Read-only snapshot of the current board: FEN, move history, side to move, and game status. Use this for coaching and analysis (openings, plans, positional advice). Not a substitute for get_hint when the student wants the engine-suggested best move.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'get_hint',
        description:
          'Returns the engine-suggested best move for the side to move at the requested difficulty. Use when the student explicitly asks for a move suggestion; not a substitute for explaining the position (use get_game_state for that).',
        parameters: {
          type: 'object',
          properties: {
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          },
        },
      },
      {
        name: 'end_game',
        description: 'End the current chess game and show results; does not return full position text for coaching.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'undo_move',
        description: 'Undo the last move in the current game.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'redo_move',
        description: 'Redo a previously undone move in the current game.',
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
    description:
      'A history quiz game. Place historical events in chronological order. 3 lives. For hints or coaching about where the current event fits, call get_game_state first (read-only snapshot); the model should give tailored guidance in chat — there is no built-in hint tool.',
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
        name: 'get_game_state',
        description:
          'Read-only quiz snapshot: placed timeline (with years), current card title and category only (year omitted so you do not spoil the answer), score, lives, round, deck remaining count. Use before giving placement hints or chronology coaching in chat.',
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
