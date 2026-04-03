# In-App Login Flow + E2E Tests

Fix the broken auth flow where the Electron renderer redirects away from the app on login, replace with an in-app login/signup screen, and add Playwright e2e tests covering auth, initialization, and chess plugin.

## Problem

When `CHATBRIDGE_SERVER_URL` is set, `src/renderer/index.tsx` checks auth via `GET /api/auth/session`. If unauthenticated, it does `window.location.href = serverUrl/login` — navigating the Electron window to the server's Next.js login page. After login, the server redirects to its own home page (`server/app/page.tsx`) which shows "Logged in as ... connect your chatbox client." The Electron window is stuck on the server page with no way back to the chatbox renderer.

## Decisions

- **In-app login form** — build login/signup UI directly in the renderer as a React component, no redirect
- **Email + password only** — matches server's auto-create behavior
- **E2E scope** — auth flow + post-login initialization + chess plugin

---

## 1. Auth Flow Fix

Replace the `window.location.href` redirect in `src/renderer/index.tsx` with an in-app auth gate.

**Current flow (broken):**
1. `checkAuth()` calls `GET /api/auth/session`
2. No session → `window.location.href = serverUrl/login` (leaves the app)
3. User logs in on server page → server redirects to `/` → stuck

**New flow:**
1. `checkAuth()` calls `GET /api/auth/session`
2. No session → render `<LoginScreen>` into `#root` (stays in the app)
3. User fills form → JS calls the NextAuth credentials endpoint directly
4. On success → `startApp()` initializes chatbox normally

**Modified:** `src/renderer/index.tsx:175-199`

The `checkAuth` block changes from:

```ts
if (serverUrl) {
  checkAuth().then((authenticated) => {
    if (!authenticated) return  // already redirected away
    startApp()
  })
}
```

To:

```ts
if (serverUrl) {
  checkAuth().then((authenticated) => {
    if (authenticated) {
      startApp()
    } else {
      renderLoginScreen(serverUrl)  // renders LoginScreen into #root
    }
  })
}
```

`renderLoginScreen()` renders `<LoginScreen serverUrl={serverUrl} onSuccess={startApp} />` into the root div, replacing the splash screen.

---

## 2. LoginScreen Component

**New file:** `src/renderer/components/auth/LoginScreen.tsx`

Uses Mantine components matching the chatbox aesthetic. Centered card layout, chatbox logo, dark theme support via CSS variables.

**Props:**
- `serverUrl: string` — the ChatBridge server URL
- `onSuccess: () => void` — called after successful auth to initialize the app

**Layout:**
- Vertically centered container (max-width 400px)
- Chatbox logo SVG at top (inline SVG from splash screen)
- "Sign In" / "Sign Up" toggle — both modes use the same email + password fields. The server auto-creates users on first login, so signup is just a different heading/button label.
- `TextInput` for email, `PasswordInput` for password (Mantine)
- `Button` submit (Mantine)
- `Alert` for errors (Mantine)
- Toggle link: "Don't have an account? Sign up" / "Already have an account? Sign in"

**Auth mechanism:**
1. Fetch CSRF token: `GET {serverUrl}/api/auth/csrf` → `{ csrfToken }`
2. Submit credentials: `POST {serverUrl}/api/auth/callback/credentials` with form-encoded body `{ csrfToken, email, password }` and `credentials: 'include'`
3. NextAuth validates, sets JWT cookie, returns redirect URL
4. If successful (response URL doesn't contain `error`) → call `onSuccess()`
5. If error → display in Alert component

**Styling:** Uses `var(--chatbox-background-*)` and `var(--chatbox-tint-brand)` CSS variables for theme consistency. The component renders before Mantine's theme provider is initialized, so it uses a standalone `MantineProvider` wrapper with the same theme config.

---

## 3. Playwright E2E Tests

**New file:** `server/__tests__/e2e/chatbridge-flow.e2e.ts`

Tests run against the Vite dev server (port 1212) and the Next.js server (port 3000). Playwright drives Chromium to test the renderer as a web app.

### Group 1: Auth Flow
- Login screen renders with email and password fields
- Sign in with valid credentials → chatbox sidebar loads
- Sign in with wrong password → error message shown
- Toggle to signup mode → heading and button text change
- Sign up with new email → account created, chatbox loads
- Logout from sidebar → returns to login screen

### Group 2: Post-Login Initialization
- After login, sidebar is visible with session list
- ChatBridgeAccountSection shows logged-in email
- Can navigate to create a new chat session

### Group 3: Chess Plugin
- Plugin tools are loaded (verify via console log or DOM)
- In a chat session, a tool call pill with plugin prefix renders correctly
- PluginContainer mounts when a plugin session is active

### Test Infrastructure

**Playwright config changes:** Add the Vite dev server as a second `webServer`:

```ts
webServer: [
  {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    cwd: './server',
  },
  {
    command: 'CHATBRIDGE_SERVER_URL=http://localhost:3000 pnpm dev:web',
    url: 'http://localhost:1212',
  },
]
```

Note: Need a `dev:web` script that runs the Vite dev server without Electron (just the renderer). Or tests can use the existing baseURL of `localhost:3000` for server auth endpoints and navigate to `localhost:1212` for the renderer.

**Test user management:**
- Each test uses a unique email (timestamp-based)
- Cleanup via Prisma `deleteMany` in `afterAll`

**Auth helper:** Shared `login(page, serverUrl, email, password)` function that fills the in-app form and waits for the sidebar to appear.

---

## 4. Files

### New

| File | Purpose |
|------|---------|
| `src/renderer/components/auth/LoginScreen.tsx` | In-app login/signup form |
| `server/__tests__/e2e/chatbridge-flow.e2e.ts` | E2E tests: auth + init + chess |

### Modified

| File | Change |
|------|--------|
| `src/renderer/index.tsx` | Replace redirect with LoginScreen render |
| `playwright.config.ts` | Add Vite dev server as second webServer |

### Unchanged

| File | Why |
|------|-----|
| `server/app/login/page.tsx` | Server login page for direct web access |
| `server/app/page.tsx` | Server status page |
| `server/lib/auth.ts` | Auth config (auto-create handles signup) |
