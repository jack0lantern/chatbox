### **Case Study Analysis**

The evolution of TutorMeAI from a simple chatbot into a comprehensive educational orchestration platform presents a massive structural engineering challenge. The core problem identified in the case study is expanding the system to host third-party applications directly within the conversational interface. Because external developers control their own application logic and user interfaces, the chat system must be able to discover tools, invoke them with accurate parameters, render unknown interfaces seamlessly, and track when tasks are completed. Doing this without prior knowledge of what a third party might build requires a highly resilient, programmatic boundary.

Designing this boundary for a K-12 educational environment elevates trust and safety to the paramount ethical consideration. We must absolutely prevent broken or malicious applications from exposing sensitive student data, displaying harmful content, or hijacking the user's session. Ethically, the system must prioritize student privacy and teacher control over developer convenience.

To solve these problems, we had to navigate several major architectural trade-offs. The most significant trade-off involved the integration method for rendering external user interfaces. While native components offer smoother data binding, we opted for strictly sandboxed iframes. This trades a degree of visual fluidity for maximum security, physically preventing third-party code from accessing the parent application’s document object model or scraping student chat history.

Another critical trade-off involved authentication and credential management. Allowing the AI model or the client’s browser to directly handle OAuth tokens introduces severe security vulnerabilities. We chose to implement a server-side backend proxy. When the chatbot invokes a tool, our secure backend intercepts the request, attaches the necessary credentials retrieved from our database, and makes the API call on the user's behalf. Furthermore, modern identity providers block logins inside iframes. We resolved this by centralizing all authentication via the parent platform, completely removing the burden of OAuth from the third-party iframe.

Ultimately, we landed on an architecture that builds safety into the API contract from the ground up. By enforcing strict JSON schemas for tool registration, executing all authenticated requests through a secure server proxy, and isolating user interfaces within strict iframes, we protect the user while maintaining a dynamic learning environment. We manage the AI's context window dynamically—injecting only the relevant application schemas into the prompt—to keep performance high and costs low. This ensures students can seamlessly play educational games or use simulators with natural conversational handoffs, while the platform remains secure, scalable, and fully controlled by educators.

### ChatBridge: Architecture & Security Blueprint
System Context: We are building "ChatBridge," a Next.js-based AI chat platform that orchestrates third-party applications inside a chat interface. The system must securely render third-party UIs, manage state bidirectionally, and handle OAuth flows without exposing sensitive credentials to the AI or the client browser.
1. Core Technology Stack
Framework: Next.js (App Router, Serverless API routes)
Authentication: NextAuth.js
Database: PostgreSQL (via Supabase or Prisma)
AI Agent: OpenAI (GPT-4o-mini) with function calling
Real-time: Server-Sent Events (SSE) for AI streaming
2. Sandboxing & UI Security
Iframe Constraints: Third-party UIs are rendered in strict iframes using sandbox="allow-scripts allow-same-origin". Popups are explicitly disabled to prevent clickjacking and malicious redirects.
Communication Bridge: The parent window and iframe communicate exclusively via the window.postMessage API using a strict JSON event schema (INVOKE_TOOL, STATE_UPDATE, TASK_COMPLETE).
3. Authentication Architecture (Platform-Brokered)
The platform handles three app types: Internal, External (Public), and External (Authenticated). For Authenticated apps (e.g., Spotify), the iframe NEVER handles its own login.
Account Linking: NextAuth is used to manage both the primary user session and third-party OAuth tokens. Third-party tokens are stored in the PostgreSQL Account table linked to the primary User ID.
Parent-Level OAuth: If an app requires authentication, the parent Next.js application intercepts the request and triggers signIn('provider'). This executes the OAuth flow in the top-level window, completely bypassing X-Frame-Options blocking issues.
Automated Refreshing: NextAuth's backend logic automatically refreshes expired access tokens in the background.
4. Tool Invocation Security (Server-Side Proxy)
To prevent Prompt Injection leaks, the AI model NEVER sees the user's raw OAuth tokens or API keys.
Intent Routing Only: The LLM simply outputs a JSON tool call intent (e.g., {"tool": "spotify_create", "params": {"name": "Hits"}}).
Backend Proxy Execution: A secure Next.js API route intercepts this intent. The server fetches the user's NextAuth tokens from PostgreSQL, injects them into the HTTP headers, and makes the API call to the third party securely from the server.
Sanitized Handoff: The backend passes the safe result back to the LLM to continue the conversation, and uses postMessage to pass temporary session credentials to the iframe so the UI can render.
5. The Step-by-Step Execution Flow (External Auth App)
Trigger: User asks the AI to use a tool (e.g., "Play Spotify").
Detection: Backend proxy intercepts the tool call and checks PostgreSQL for a linked Spotify token.
Auth Prompt (If no token): Backend returns AUTH_REQUIRED. The Chat UI renders a native "[Connect Spotify]" button. User clicks, triggering a top-level NextAuth redirect. Tokens are securely saved.
Execution (If token exists): Backend proxy securely executes the API call to Spotify using the saved token.
Rendering: Chat UI renders the third-party iframe.
Handoff: Chat UI sends window.postMessage({ type: 'INVOKE_TOOL', payload: { ...params, credentials } }) to the iframe.
Completion: Iframe finishes its task and sends window.postMessage({ type: 'TASK_COMPLETE', payload: { result } }) back to the parent. Chatbot resumes conversation.

```
+-------------------------------------------------------------+
|                     FRONTEND (Client)                       |
|                                                             |
|  +-------------+                      +------------------+  |
|  |             |                      |                  |  |
|  |   Chat UI   |====(Inject Token)===>| Sandboxed Iframe |  |
|  |             |                      |  (3rd Party UI)  |  |
|  +-------------+                      +------------------+  |
|    ^        |                                               |
+----|--------|-----------------------------------------------+
     |        | 1. User Message ("Create Spotify playlist")
     |        v
+----|--------|-----------------------------------------------+
|    |   BACKEND (Server-Side Proxy & Auth)                   |
|    |                                                        |
|  +-------------+      2. Context &        +--------------+  |
|  |             |--------App Schemas------>|              |  |
|  |  Chat API   |                          |  LLM (Agent) |  |
|  |             |<----3. Tool Call Intent--| (NO SECRETS) |  |
|  +-------------+                          +--------------+  |
|    |        ^
| 4. Route    | 8. Tool Result (Sanitized)
|    v        |
|  +-------------+      5. Lookup Session   +--------------+  |
|  |             |------------------------->|              |  |
|  | Tool Proxy  |                          |   Database   |  |
|  | (Execution) |<----6. Secure JWT/Token--|  (NextAuth)  |  |
|  +-------------+                          +--------------+  |
|    |        ^                                    ^
+----|--------|------------------------------------|----------+
     |        | 7. Authenticated HTTP Call         |
     v        |                                    v
+-------------------------+             +---------------------+
|                         |             |                     |
|     3rd Party API       |             | 3rd Party OAuth     |
|   (e.g., Spotify API)   |             | (Login / Consent)   |
|                         |             |                     |
+-------------------------+             +---------------------+

```

---

### **Pre-search Document: Architecture & Planning Checklist**

#### **Phase 1: Define Your Constraints**

1\. Scale & Load Profile

* **Users & Load**: Targeting 100 to 1,000 users at launch. Traffic will be spiky, aligning with school hours.  
* **Concurrency**: Expecting 1 concurrent app session per user at a time.  
* **Cold Starts**: High tolerance for cold starts on app loading during the MVP phase.

2\. Budget & Cost Ceiling

* **Budget**: Bootstrapped/Solo budget (\<$50/mo). Pay-per-use infrastructure is heavily preferred.  
* **LLM Cost**: Will use GPT-4o-mini for cost efficiency on tool invocations. We will trade money for time by utilizing managed services like Vercel and Supabase.

3\. Time to Ship

* **Timeline**: One-week sprint for the MVP. Speed-to-market and meeting the 24-hour/4-day/7-day deadlines are the strict priorities over long-term microservice maintainability.

4\. Security & Sandboxing

* **Isolation**: Third-party UI is isolated via strict iframes with sandbox="allow-scripts allow-same-origin". Popups are explicitly disabled to prevent clickjacking.  
* **Malicious Apps**: Contained by the physical sandbox (cannot access parent DOM) and by the Server-Side Proxy (cannot steal API keys).

5\. Team & Skill Constraints

* **Team**: Solo developer utilizing the React/Next.js and Node.js ecosystem.

#### **Phase 2: Architecture Discovery**

6\. Plugin Architecture & API Specification

* **Integration**: Iframe-based rendering with a strict postMessage protocol for bidirectional communication.  
* **Registration API**: Apps register via POST /api/plugins/register. Developers provide a manifest including appName, iframeUrl, authPattern (Internal, External Public, or External Authenticated), and toolSchemas.  
* **Invocation API (Parent to Iframe)**: Platform sends INVOKE\_TOOL via postMessage containing toolName and parameters.  
* **Completion API (Iframe to Parent)**: Plugin sends TASK\_COMPLETE via postMessage containing result and isComplete: true.  
* **Discovery**: The chatbot discovers tools dynamically by querying the database for registered apps during the chat lifecycle.

7\. LLM & Function Calling

* **Provider**: OpenAI GPT-4 with native function calling.  
* **Context Management**: Dynamic Filtering. To save context space, the backend queries the database for *only* the currently requested/active app's schema and injects that dynamically into the system prompt.

8\. Real-Time Communication

* **Protocol**: Server-Sent Events (SSE) for streaming the AI chat responses.  
* **Bidirectional Flow**: The frontend sends HTTP POST requests for user messages and iframe updates, which trigger new SSE streams for the AI's reply.

9\. State Management

* **Storage**: Chat history and App state live in the PostgreSQL database.  
* **Persistence**: Persistent Pause strategy. The app's JSON state is saved across sessions. If the user closes the chat, the database freezes the state; upon return, the chat hydrates the iframe with the exact last state.

10\. Authentication Architecture

* **Strategy**: Platform-Brokered Auth using NextAuth.  
* **Flow**: The parent window handles the OAuth redirect to prevent iframe blocks. NextAuth stores tokens securely in the database. The backend proxy attaches these credentials to server-side API calls when invoking tools.

11\. Database & Persistence

* **Database**: PostgreSQL via Supabase/Prisma.  
* **Schema**: Relational tables for Users, Accounts (NextAuth), and Plugin Registrations. JSONB columns store flexible third-party App State and Tool Invocation History.

#### **Phase 3: Post-Stack Refinement**

12\. Security Deep Dive

* **CSP**: Enforced via headers to restrict iframe sources to registered developer domains.  
* **Rate Limiting**: Implemented per app and per user session to prevent API abuse.

Here is a highly structured, technical summary of the ChatBridge authentication and security architecture.

***

### ⚙️ ChatBridge: Architecture & Security Blueprint
**System Context:** We are building "ChatBridge," a Next.js-based AI chat platform that orchestrates third-party applications inside a chat interface. The system must securely render third-party UIs, manage state bidirectionally, and handle OAuth flows without exposing sensitive credentials to the AI or the client browser. 

#### 1. Core Technology Stack
* **Framework:** Next.js (App Router, Serverless API routes)
* **Authentication:** NextAuth.js
* **Database:** PostgreSQL (via Supabase or Prisma)
* **AI Agent:** OpenAI (GPT-4o-mini) with function calling
* **Real-time:** Server-Sent Events (SSE) for AI streaming

#### 2. Sandboxing & UI Security
* **Iframe Constraints:** Third-party UIs are rendered in strict iframes using `sandbox="allow-scripts allow-same-origin"`. [cite_start]**Popups are explicitly disabled** to prevent clickjacking and malicious redirects. [cite: 40, 172, 173]
* [cite_start]**Communication Bridge:** The parent window and iframe communicate *exclusively* via the `window.postMessage` API using a strict JSON event schema (`INVOKE_TOOL`, `STATE_UPDATE`, `TASK_COMPLETE`). [cite: 42, 85, 146]

#### 3. Authentication Architecture (Platform-Brokered)
[cite_start]The platform handles three app types: Internal, External (Public), and External (Authenticated). [cite: 68, 69, 70] For Authenticated apps (e.g., Spotify), the iframe NEVER handles its own login.
* [cite_start]**Account Linking:** NextAuth is used to manage both the primary user session and third-party OAuth tokens. [cite: 35, 71] Third-party tokens are stored in the PostgreSQL `Account` table linked to the primary `User` ID.
* [cite_start]**Parent-Level OAuth:** If an app requires authentication, the parent Next.js application intercepts the request and triggers `signIn('provider')`. [cite: 71] This executes the OAuth flow in the top-level window, completely bypassing `X-Frame-Options` blocking issues.
* [cite_start]**Automated Refreshing:** NextAuth's backend logic automatically refreshes expired access tokens in the background. [cite: 71]

#### 4. Tool Invocation Security (Server-Side Proxy)
To prevent **Prompt Injection** leaks, the AI model NEVER sees the user's raw OAuth tokens or API keys.
* **Intent Routing Only:** The LLM simply outputs a JSON tool call intent (e.g., `{"tool": "spotify_create", "params": {"name": "Hits"}}`).
* **Backend Proxy Execution:** A secure Next.js API route intercepts this intent. The server fetches the user's NextAuth tokens from PostgreSQL, injects them into the HTTP headers, and makes the API call to the third party securely from the server.
* [cite_start]**Sanitized Handoff:** The backend passes the safe result back to the LLM to continue the conversation, and uses `postMessage` to pass temporary session credentials to the iframe so the UI can render. [cite: 71]

#### 5. The Step-by-Step Execution Flow (External Auth App)
1.  **Trigger:** User asks the AI to use a tool (e.g., "Play Spotify").
2.  **Detection:** Backend proxy intercepts the tool call and checks PostgreSQL for a linked Spotify token.
3.  **Auth Prompt (If no token):** Backend returns `AUTH_REQUIRED`. The Chat UI renders a native "[Connect Spotify]" button. User clicks, triggering a top-level NextAuth redirect. Tokens are securely saved.
4.  **Execution (If token exists):** Backend proxy securely executes the API call to Spotify using the saved token.
5.  **Rendering:** Chat UI renders the third-party iframe.
6.  **Handoff:** Chat UI sends `window.postMessage({ type: 'INVOKE_TOOL', payload: { ...params, credentials } })` to the iframe.
7.  **Completion:** Iframe finishes its task and sends `window.postMessage({ type: 'TASK_COMPLETE', payload: { result } })` back to the parent. [cite_start]Chatbot resumes conversation. [cite: 42, 106]

***

13\. Error Handling & Resilience

* **Timeouts**: 10-second timeout on the backend proxy.  
* **Circuit Breaker**: If an app fails or times out 3 times consecutively, it is flagged as "unreliable" in the DB.  
* **Recovery**: The chatbot is fed a system error and generates a conversational apology/explanation.

14\. Testing Strategy

* **E2E Testing**: Playwright used to test the full lifecycle: invocation → UI render → interaction → completion.  
* **Plugin Testing**: Developers use secure tunnels (e.g., Ngrok) to connect their local environments to the cloud staging platform.

15\. Deployment & Operations

* **Hosting**: ChatBridge platform (Next.js) on Vercel.  
* **Third-Party Hosting**: Developers are responsible for hosting their own iframe content.  
* **Monitoring**: Platform tracks tool invocation success rates and latency per plugin.

