/*
 * WebPwn Coach — Knowledge Base
 * A curated library of web-assessment concepts. This is NOT a payload
 * dictionary. Each entry teaches the MENTALITY: how a consultant frames
 * the concept, what to observe, and the full Assessment Lens.
 *
 * Every concept carries a `lens` with:
 *   who, what, when, where, howAssessment, howTechnical,
 *   whyVuln, whyWorked, whyFailed, validate, fix, report, interview
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  const K = [
    {
      id: "idor",
      name: "IDOR / Broken Object-Level Authorization",
      aliases: ["idor", "insecure direct object", "object reference", "bola", "object level"],
      tags: ["access-control", "authorization"],
      simple:
        "The app trusts an ID you send and hands back the matching object without checking that YOU are allowed to see it.",
      example:
        "Changing /account?id=1023 to /account?id=1024 and seeing another customer's invoice.",
      identify: [
        "Requests carry an identifier (numeric id, UUID, filename, account number).",
        "The identifier is user-controllable and predictable or enumerable.",
        "The response content changes based on that identifier.",
      ],
      test: [
        "Capture a request that references an object you own.",
        "Swap the identifier for a neighbouring/other-user value in one modified request.",
        "Compare responses across two accounts you control (A vs B).",
      ],
      mistakes: [
        "Only trying id+1 and giving up when it 403s.",
        "Not proving impact with a second account you actually own.",
      ],
      senior: [
        "Maps every object type the app exposes and asks 'who should own this?'",
        "Tests read AND write (view vs modify vs delete) separately.",
      ],
      mental:
        "Every ID is a door. Authorization is the lock. IDOR is a door with no lock.",
      coach: [
        "What object is actually being requested here?",
        "Who is supposed to be allowed to reach that object?",
        "If you changed the identifier by one, what SHOULD happen?",
        "How would you prove impact without touching data that isn't yours?",
      ],
      hints: [
        "Look at parameters that look like identifiers (id=, user=, /123/, .pdf).",
        "Use two accounts you control and swap one account's id into the other's session.",
      ],
      next: "Find the parameter that names an object, then ask: is ownership checked, or just identity?",
      lens: {
        who: "Any authenticated (sometimes unauthenticated) user who can reach the endpoint.",
        what: "Reading or modifying objects belonging to other users/tenants.",
        when: "Any request that references a specific record by id/reference.",
        where: "URL path, query string, JSON body, headers — anywhere the id travels.",
        howAssessment: "Enumerate object types, control two accounts, swap references, compare responses.",
        howTechnical: "Server authenticates the session but never checks object ownership before returning data.",
        whyVuln: "Authentication ≠ authorization. The app confirms WHO you are, not WHAT you may touch.",
        whyWorked: "The identifier was user-controlled and the ownership check was missing.",
        whyFailed: "Server derived the id from session state, or enforced a per-object ACL.",
        validate: "Reproduce with two controlled accounts; confirm A can read/alter B's object.",
        fix: "Enforce object-level authorization server-side; scope queries to the session's subject.",
        report: "Show the two-account proof, the swapped request, and the exposed data (minimally).",
        interview: "Explain why authentication does not imply authorization, and how you'd prove BOLA safely.",
      },
    },
    {
      id: "access-control",
      name: "Broken Access Control (Function-Level)",
      aliases: ["access control", "authorization", "privilege escalation", "forced browsing", "admin panel", "rbac bypass"],
      tags: ["access-control"],
      simple:
        "Actions or pages are protected only by hiding them, not by checking your role on the server.",
      example:
        "A normal user browsing straight to /admin/deleteUser and it works.",
      identify: [
        "UI hides buttons based on role but the endpoint still exists.",
        "Role is decided client-side or via a tamperable value.",
        "Sensitive verbs (DELETE, PUT, admin actions) exist.",
      ],
      test: [
        "As a low-priv user, replay a high-priv request captured elsewhere.",
        "Force-browse to admin routes directly.",
        "Flip role indicators (cookie, JSON field, header) and observe.",
      ],
      mistakes: [
        "Assuming a hidden button means the action is protected.",
        "Testing only vertical (user→admin) and forgetting horizontal (user→user).",
      ],
      senior: [
        "Builds a matrix of roles × actions and probes each cell.",
        "Distinguishes authentication, horizontal and vertical authorization.",
      ],
      mental: "If the server doesn't enforce the boundary, the UI is just decoration.",
      coach: [
        "Which role is this action meant for?",
        "Is that decision made in the browser or on the server?",
        "What happens if you send the request without the UI?",
      ],
      hints: [
        "Capture an admin action, then replay it inside a low-priv session.",
        "Try requesting admin endpoints directly by URL.",
      ],
      next: "List the app's roles and the actions each should own — then test the gaps.",
      lens: {
        who: "Lower-privileged or unauthenticated users.",
        what: "Performing actions or viewing data above their privilege level.",
        when: "Any state-changing or sensitive endpoint.",
        where: "Admin routes, privileged API verbs, role-gated features.",
        howAssessment: "Role×action matrix; replay privileged requests in low-priv sessions.",
        howTechnical: "Access checks live in the UI or are missing on the server route.",
        whyVuln: "Enforcement was placed at the presentation layer, not the trust boundary.",
        whyWorked: "The server accepted the request without re-checking authorization.",
        whyFailed: "Server-side middleware enforced role on every sensitive route.",
        validate: "Reproduce the privileged action from a low-priv account.",
        fix: "Centralised server-side authorization on every protected route; deny by default.",
        report: "Show the low-priv session performing the high-priv action.",
        interview: "Contrast authentication vs horizontal vs vertical authorization with examples.",
      },
    },
    {
      id: "jwt",
      name: "JWT (JSON Web Tokens)",
      aliases: ["jwt", "json web token", "bearer token", "jws", "jwks"],
      tags: ["auth", "session"],
      simple:
        "A signed, self-describing token: header.payload.signature. The server trusts it if the signature checks out.",
      example:
        "A login returns eyJ...; the app trusts the 'role: user' claim inside it on every request.",
      identify: [
        "Three base64url segments separated by dots.",
        "Sent in Authorization: Bearer or a cookie.",
        "Payload decodes to readable JSON claims.",
      ],
      test: [
        "Decode header/payload; note alg and claims.",
        "Test alg confusion (alg=none, RS256→HS256), weak HMAC secret.",
        "Tamper claims (role, sub, exp) and see if the signature is actually verified.",
      ],
      mistakes: [
        "Thinking base64 = encrypted (it's just encoded, fully readable).",
        "Editing the payload but forgetting the server may still verify the signature.",
      ],
      senior: [
        "Asks where the verification key comes from and whether alg is pinned.",
        "Checks expiry, revocation, and audience/issuer validation.",
      ],
      mental: "A JWT is a claim signed by someone. Your job: find who verifies the signature — and how.",
      coach: [
        "What is the token actually asserting about you?",
        "Which part makes it trustworthy — and who checks it?",
        "What algorithm does the header claim, and can you influence it?",
      ],
      hints: [
        "Decode the payload — is 'role' or 'admin' a claim you'd love to change?",
        "Try alg=none or an RS256→HS256 confusion where the public key becomes the HMAC secret.",
      ],
      next: "Decode the token first. Understand the claims before you touch the signature.",
      lens: {
        who: "Any holder of a token, or an attacker who can forge/replay one.",
        what: "Forging identity/role claims or replaying tokens.",
        when: "Any request that carries the token for auth.",
        where: "Authorization header, cookies, local/session storage.",
        howAssessment: "Decode, inspect alg/claims, test signature verification and key handling.",
        howTechnical: "Weak/absent verification, alg confusion, secret leakage, no expiry/revocation.",
        whyVuln: "The token is only as trustworthy as the verification step behind it.",
        whyWorked: "Server accepted an unsigned or attacker-signed token, or a stale one.",
        whyFailed: "Strong key management, pinned algorithm, verified exp/aud/iss.",
        validate: "Craft a modified token that the server accepts and act with elevated rights.",
        fix: "Pin algorithm, verify signature with correct key, validate exp/aud/iss, support revocation.",
        report: "Show decoded claims, the forged token, and the accepted privileged action.",
        interview: "Explain JWT structure and the alg-confusion / none-algorithm classes of bug.",
      },
    },
    {
      id: "oauth",
      name: "OAuth 2.0 / OIDC",
      aliases: ["oauth", "oidc", "openid", "authorization code", "redirect_uri", "sso", "social login"],
      tags: ["auth"],
      simple:
        "A delegation protocol: you let App A get limited access to App B on your behalf, via tokens and redirects.",
      example:
        "'Sign in with Google' — Google issues a code, your app swaps it for a token.",
      identify: [
        "Redirects with client_id, redirect_uri, response_type, scope, state.",
        "Callback endpoints receiving code/token.",
        "Third-party identity provider involvement.",
      ],
      test: [
        "Probe redirect_uri validation (open redirect / token leak).",
        "Check the state parameter (CSRF protection) and PKCE presence.",
        "Look for token/code leakage via Referer, logs, or account linking flaws.",
      ],
      mistakes: [
        "Treating OAuth as 'just login' and skipping the redirect/state analysis.",
        "Ignoring account-linking and scope-escalation abuse.",
      ],
      senior: [
        "Traces the full flow and every trust boundary crossed.",
        "Focuses on redirect_uri matching, state/PKCE, and token audience.",
      ],
      mental: "OAuth is a relay race of trust. Bugs hide in the hand-offs — redirects and callbacks.",
      coach: [
        "Which parties are involved and what does each one trust?",
        "Where does the token or code actually change hands?",
        "How strictly is redirect_uri validated?",
      ],
      hints: [
        "Tamper redirect_uri to a host you control and watch for a leaked code/token.",
        "Remove or replay the state parameter to test CSRF on the callback.",
      ],
      next: "Draw the flow (client, auth server, resource server) before touching any parameter.",
      lens: {
        who: "Users, the client app, the authorization server, the resource server.",
        what: "Stealing codes/tokens, forcing account linking, escalating scope.",
        when: "During the authorization/redirect/callback exchange.",
        where: "Authorization endpoint, redirect_uri, token endpoint, callback.",
        howAssessment: "Map parties/tokens; probe redirect_uri, state, PKCE, scope, audience.",
        howTechnical: "Loose redirect matching, missing state/PKCE, token leakage, weak binding.",
        whyVuln: "Trust is delegated across parties; a weak hand-off breaks the whole chain.",
        whyWorked: "A redirect or callback accepted attacker-controlled input.",
        whyFailed: "Exact redirect matching, enforced state+PKCE, audience-bound tokens.",
        validate: "Capture a code/token in an attacker-controlled context and use it.",
        fix: "Exact redirect_uri allowlist, mandatory state+PKCE, audience/issuer checks.",
        report: "Diagram the flow and mark exactly where the token leaked or trust broke.",
        interview: "Walk the authorization-code flow and name where CSRF/redirect bugs live.",
      },
    },
    {
      id: "session",
      name: "Sessions & Session Management",
      aliases: ["session", "session id", "session token", "session fixation", "logout"],
      tags: ["auth", "session"],
      simple:
        "After login the server remembers you via a session identifier. If that identifier is guessable, stealable, or never expires, identity breaks.",
      example:
        "A session cookie that stays valid after logout, or is predictable enough to guess.",
      identify: [
        "A cookie/token that represents 'logged-in you'.",
        "Behaviour around login, logout, and idle timeout.",
        "Whether the identifier rotates after privilege changes.",
      ],
      test: [
        "Does the session id rotate on login (fixation)?",
        "Is it invalidated server-side on logout?",
        "Is it random, HttpOnly, Secure, SameSite-scoped?",
      ],
      mistakes: [
        "Assuming logout on the client actually kills the server session.",
        "Ignoring session fixation because 'it looks random'.",
      ],
      senior: [
        "Tests the full lifecycle: creation, rotation, expiry, revocation.",
        "Checks binding to device/IP and concurrent-session handling.",
      ],
      mental: "A session is a promise: 'this token = this human'. Break the promise, become someone else.",
      coach: [
        "What single value proves you're logged in?",
        "What happens to that value when you log out?",
        "Does it change after you authenticate?",
      ],
      hints: [
        "Log out, then replay an old request with the previous session id.",
        "Compare the session id before and after login for fixation.",
      ],
      next: "Find the one value that = 'authenticated me', then attack its lifecycle.",
      lens: {
        who: "Anyone who can obtain, guess, or fixate another user's session.",
        what: "Impersonating a user by controlling their session identifier.",
        when: "Across login, logout, timeout, and privilege transitions.",
        where: "Cookies, tokens, URL parameters (bad), storage.",
        howAssessment: "Exercise the full session lifecycle and inspect the identifier's properties.",
        howTechnical: "Predictable IDs, no rotation, no server-side invalidation, weak cookie flags.",
        whyVuln: "The identifier IS the identity; weak handling lets it be stolen or reused.",
        whyWorked: "Old/known/fixed session id was still accepted by the server.",
        whyFailed: "Random IDs, rotation on login, server-side invalidation, hardened cookies.",
        validate: "Reuse a session id post-logout or after fixation to act as the victim.",
        fix: "High-entropy IDs, rotate on auth, invalidate server-side, HttpOnly/Secure/SameSite.",
        report: "Show the reused/fixated identifier granting access as another user.",
        interview: "Describe session fixation vs hijacking and the defenses for each.",
      },
    },
    {
      id: "cookie",
      name: "Cookies & Cookie Security",
      aliases: ["cookie", "httponly", "samesite", "secure flag", "set-cookie"],
      tags: ["session", "auth"],
      simple:
        "Small values the browser attaches to requests. Their flags (HttpOnly, Secure, SameSite) decide who can read and send them.",
      example:
        "A session cookie without HttpOnly is readable by XSS; without SameSite it rides along in CSRF.",
      identify: [
        "Set-Cookie response headers and their attributes.",
        "Which cookies carry auth vs preferences.",
        "Scope: Domain, Path, and SameSite value.",
      ],
      test: [
        "Check HttpOnly, Secure, SameSite on sensitive cookies.",
        "Assess scope/over-sharing across subdomains.",
        "Correlate missing flags with XSS/CSRF exposure.",
      ],
      mistakes: [
        "Auditing flags in isolation without asking what the cookie protects.",
        "Overlooking overly broad Domain scoping.",
      ],
      senior: [
        "Connects each flag to a concrete attack it prevents.",
        "Checks cookie prefixes (__Host-, __Secure-) and scope minimisation.",
      ],
      mental: "Cookie flags are seatbelts. Absent flags tell you which crash is survivable.",
      coach: [
        "What does this cookie actually protect?",
        "Which attack does each missing flag re-enable?",
        "How widely is it scoped — and does it need to be?",
      ],
      hints: [
        "Missing HttpOnly + a reflected XSS = session theft.",
        "Missing/Lax-vs-None SameSite changes your CSRF story.",
      ],
      next: "Read the Set-Cookie headers first; flags tell you which attacks are even in play.",
      lens: {
        who: "Attackers leveraging XSS, CSRF, or network position.",
        what: "Reading or replaying auth cookies, or forcing them along.",
        when: "On every request the browser attaches the cookie to.",
        where: "Set-Cookie headers, request Cookie headers.",
        howAssessment: "Inventory sensitive cookies and map missing flags to attacks.",
        howTechnical: "Missing HttpOnly/Secure/SameSite, over-broad Domain/Path.",
        whyVuln: "Flags are the cookie's access-control; missing them widens exposure.",
        whyWorked: "A missing flag re-enabled an attack (theft via XSS, ride-along via CSRF).",
        whyFailed: "Hardened flags and minimal scope closed the vector.",
        validate: "Demonstrate the concrete downstream attack the missing flag enabled.",
        fix: "Set HttpOnly+Secure+SameSite appropriately; use __Host- prefix; minimise scope.",
        report: "List cookies, their flags, and the attack each gap enables.",
        interview: "Explain what each cookie flag defends against.",
      },
    },
    {
      id: "csrf",
      name: "CSRF (Cross-Site Request Forgery)",
      aliases: ["csrf", "xsrf", "cross-site request forgery", "anti-csrf", "csrf token"],
      tags: ["session", "state-change"],
      simple:
        "Another site makes your browser send a state-changing request to a site you're logged into, using your cookies automatically.",
      example:
        "A malicious page auto-submits a form that changes your email on the target app.",
      identify: [
        "State-changing actions (POST/PUT/DELETE) that rely only on cookies.",
        "No unpredictable anti-CSRF token, or one that isn't validated.",
        "SameSite not enforced.",
      ],
      test: [
        "Remove/replay the CSRF token — is it actually checked?",
        "Change method or content-type to dodge the check.",
        "Build a cross-origin request and see if it succeeds.",
      ],
      mistakes: [
        "Confusing CSRF (forces your action) with XSS (runs script).",
        "Assuming a token in the page means it's validated server-side.",
      ],
      senior: [
        "Tests token binding to the session and per-request uniqueness.",
        "Considers SameSite, Referer/Origin checks, and JSON vs form nuances.",
      ],
      mental: "CSRF abuses ambient authority: your cookie fires whether YOU meant it or not.",
      coach: [
        "What makes this request authorised — anything the attacker can't guess?",
        "Does the server truly validate the token, or just render it?",
        "Could another origin trigger this same action?",
      ],
      hints: [
        "Drop the CSRF token and resend; if it still works, it's not enforced.",
        "Check SameSite on the session cookie — Strict/Lax changes exploitability.",
      ],
      next: "For each state-changing action ask: what stops a foreign page from sending this?",
      lens: {
        who: "A logged-in victim tricked into visiting attacker content.",
        what: "Performing state changes as the victim without their intent.",
        when: "While the victim holds an active authenticated session.",
        where: "Any cookie-authenticated, state-changing endpoint.",
        howAssessment: "Test token presence/validation, method/content-type tricks, cross-origin PoC.",
        howTechnical: "Reliance on ambient cookies without an unguessable, validated token.",
        whyVuln: "Cookies are sent automatically; without a secret, requests can't be attributed to intent.",
        whyWorked: "No token (or unvalidated token) and SameSite didn't block it.",
        whyFailed: "Validated per-session token and/or SameSite=Lax/Strict.",
        validate: "Cross-origin PoC that performs the action in the victim's session.",
        fix: "Per-session validated CSRF tokens, SameSite cookies, verify Origin/Referer.",
        report: "Provide the auto-submitting PoC and the resulting state change.",
        interview: "Distinguish CSRF from XSS and list layered defenses.",
      },
    },
    {
      id: "xss",
      name: "XSS (Cross-Site Scripting)",
      aliases: ["xss", "cross-site scripting", "reflected", "stored xss", "dom xss", "innerhtml", "script injection"],
      tags: ["injection", "client-side"],
      simple:
        "User input becomes executable script in someone else's browser because it wasn't properly encoded.",
      example:
        "A comment containing <script> that runs for every visitor who views it (stored XSS).",
      identify: [
        "Reflected input appearing in HTML/JS/attribute context.",
        "User content rendered without encoding (innerHTML, templating).",
        "Sinks: document.write, innerHTML, eval, dangerous frameworks patterns.",
      ],
      test: [
        "Trace input from source to sink; identify the output context.",
        "Try context-appropriate breakouts (HTML, attribute, JS, URL).",
        "Distinguish reflected vs stored vs DOM.",
      ],
      mistakes: [
        "Firing alert(1) blindly without knowing the output context.",
        "Ignoring encoding context (HTML vs attribute vs JS differ).",
      ],
      senior: [
        "Thinks in source→sink and context, not payload lists.",
        "Assesses real impact (session, actions) and CSP interplay.",
      ],
      mental: "XSS is a context bug: the fix and the exploit both depend on WHERE input lands.",
      coach: [
        "Where does your input come out, and in what context?",
        "What character would break OUT of that context?",
        "Reflected, stored, or DOM — who gets hit and when?",
      ],
      hints: [
        "Inject a unique marker, find where it lands, then choose a context-specific breakout.",
        "Check whether encoding is applied and whether a CSP would block execution.",
      ],
      next: "Plant a harmless marker and follow it. Context first, payload second.",
      lens: {
        who: "Victims viewing attacker-influenced content; the attacker supplies input.",
        what: "Running script in victims' browsers to steal sessions or perform actions.",
        when: "Reflected: per crafted request. Stored: whenever content is viewed.",
        where: "Any place input is echoed into a page or DOM sink.",
        howAssessment: "Source→sink tracing, context identification, targeted breakouts.",
        howTechnical: "Unencoded/insufficiently-encoded output in an executable context.",
        whyVuln: "Data was interpreted as code because output encoding didn't match context.",
        whyWorked: "The chosen breakout matched the exact output context; no CSP blocked it.",
        whyFailed: "Context-aware output encoding and/or a strict CSP.",
        validate: "Prove execution with a benign PoC and show realistic impact.",
        fix: "Context-aware output encoding, safe sinks, CSP, framework auto-escaping.",
        report: "Show source, sink, context, PoC, and business impact.",
        interview: "Explain reflected/stored/DOM and why encoding is context-dependent.",
      },
    },
    {
      id: "sqli",
      name: "SQL Injection",
      aliases: ["sqli", "sql injection", "union select", "blind sql", "boolean-based", "time-based"],
      tags: ["injection", "server-side"],
      simple:
        "Your input is concatenated into a SQL query, so you can change what the query does.",
      example:
        "A search box where ' OR '1'='1 returns every row.",
      identify: [
        "Parameters that likely feed a database query (search, id, filter, login).",
        "Errors, boolean, or timing differences on input changes.",
        "Reflected data that mirrors DB content.",
      ],
      test: [
        "Probe with a single quote / boolean pairs and observe differences.",
        "Classify: error-based, union, boolean-blind, time-blind.",
        "Escalate safely to prove data access (read-only where possible).",
      ],
      mistakes: [
        "Blasting payload lists without reading responses.",
        "Not distinguishing a real difference from noise.",
      ],
      senior: [
        "Forms a hypothesis about the query and confirms with minimal probes.",
        "Prefers evidence (boolean/time oracle) over destructive proof.",
      ],
      mental: "SQLi is a grammar bug: you're editing the query's sentence, not its data.",
      coach: [
        "What query might this input become part of?",
        "What single character would change the query's meaning?",
        "What observable signal confirms your input reached SQL?",
      ],
      hints: [
        "A lone quote causing an error or a boolean pair changing results is your oracle.",
        "Blind? Use boolean/time differences instead of visible output.",
      ],
      next: "Guess the query shape first; then send the smallest probe that would prove it.",
      lens: {
        who: "Anyone who can influence a query parameter.",
        what: "Reading/altering database data or bypassing auth.",
        when: "Any input that reaches a SQL statement.",
        where: "Search, filters, ids, login, headers, anywhere feeding the DB.",
        howAssessment: "Hypothesise the query, use oracles (error/boolean/time), escalate minimally.",
        howTechnical: "String-concatenated queries instead of parameterised statements.",
        whyVuln: "Data and code share the same channel; input becomes query syntax.",
        whyWorked: "Input altered query grammar and the DB executed it.",
        whyFailed: "Parameterised queries / prepared statements separated data from code.",
        validate: "Demonstrate a controlled, evidence-based data-access proof.",
        fix: "Parameterised queries, least-privilege DB accounts, allowlist inputs.",
        report: "Show the injectable parameter, the oracle, and demonstrated impact.",
        interview: "Explain why parameterisation—not escaping—is the real fix.",
      },
    },
    {
      id: "ssrf",
      name: "SSRF (Server-Side Request Forgery)",
      aliases: ["ssrf", "server-side request forgery", "url fetch", "webhook", "internal metadata", "169.254.169.254"],
      tags: ["injection", "server-side"],
      simple:
        "You make the server fetch a URL you choose, reaching things the server can see but you can't.",
      example:
        "A URL-preview feature you point at http://169.254.169.254/ to read cloud metadata.",
      identify: [
        "Features that fetch a user-supplied URL (import, webhook, preview, PDF, image).",
        "Server-side outbound requests you can influence.",
        "Responses that reflect fetched content or timing.",
      ],
      test: [
        "Point it at a callback you control to confirm the fetch.",
        "Probe internal ranges and cloud metadata endpoints (authorised scope only).",
        "Test scheme/parser tricks and redirect following.",
      ],
      mistakes: [
        "Only trying external URLs and missing the internal-network angle.",
        "Not setting up an out-of-band listener to confirm blind SSRF.",
      ],
      senior: [
        "Thinks about what the SERVER can reach, not the attacker.",
        "Considers metadata services, internal APIs, and pivoting.",
      ],
      mental: "SSRF turns the server into your proxy into its own trusted network.",
      coach: [
        "Who actually makes the outbound request here — you or the server?",
        "What can the server reach that you cannot?",
        "How would you confirm the fetch happened if you see no response?",
      ],
      hints: [
        "Use a collaborator/callback URL to confirm blind SSRF.",
        "Cloud metadata and internal ranges are classic high-impact targets (in scope only).",
      ],
      next: "Find a feature that fetches a URL, then think from the server's network view.",
      lens: {
        who: "An attacker who controls a URL the server will fetch.",
        what: "Reaching internal services, metadata, or exfiltrating via the server.",
        when: "Any server-side fetch of user-influenced input.",
        where: "Webhooks, importers, link previews, PDF/image generators, SSO metadata.",
        howAssessment: "Confirm the fetch (OOB), enumerate internal reachability, test parsers/redirects.",
        howTechnical: "Unvalidated URL passed to a server-side HTTP client with network access.",
        whyVuln: "The server's trusted network position is exposed via attacker-chosen URLs.",
        whyWorked: "No allowlist; server fetched an internal/metadata endpoint.",
        whyFailed: "Strict allowlist, blocked internal ranges, no redirect following.",
        validate: "Prove internal reachability or metadata retrieval within scope.",
        fix: "Allowlist destinations, block internal ranges/metadata, disable redirects, isolate egress.",
        report: "Show the controlled fetch and the sensitive internal resource reached.",
        interview: "Explain SSRF impact in cloud environments and metadata risk.",
      },
    },
    {
      id: "rbac",
      name: "RBAC (Role-Based Access Control)",
      aliases: ["rbac", "role based", "roles", "permissions model", "privilege model"],
      tags: ["access-control", "authorization"],
      simple:
        "Permissions are grouped into roles; each user gets roles. Bugs appear when roles are decided or enforced in the wrong place.",
      example:
        "A 'role: admin' field in a request or token that the server trusts as-is.",
      identify: [
        "Explicit roles/permissions in tokens, cookies, or requests.",
        "Feature visibility tied to role.",
        "Server-side vs client-side role decisions.",
      ],
      test: [
        "Map roles→permissions, then probe each boundary.",
        "Attempt vertical (up a role) and horizontal (same role, other tenant) moves.",
        "Tamper role indicators and observe enforcement.",
      ],
      mistakes: [
        "Testing only 'user vs admin' and ignoring same-level tenants.",
        "Trusting the UI's idea of your role.",
      ],
      senior: [
        "Builds the full role×permission matrix and hunts missing checks.",
        "Separates role assignment from role enforcement in analysis.",
      ],
      mental: "RBAC is a matrix. Every empty-but-reachable cell is a potential finding.",
      coach: [
        "What roles exist, and what is each allowed to do?",
        "Where is the role decided — token, server, or UI?",
        "Which cell of the role×action matrix hasn't been tested?",
      ],
      hints: [
        "Change a role claim/field and replay a privileged request.",
        "Don't forget horizontal moves between same-role tenants.",
      ],
      next: "Draw the role×permission matrix first; test the boundaries it reveals.",
      lens: {
        who: "Users attempting to exceed their assigned role.",
        what: "Vertical or horizontal privilege escalation.",
        when: "On any role-gated action.",
        where: "Tokens, session, request fields, server middleware.",
        howAssessment: "Enumerate roles/permissions; probe each boundary vertically and horizontally.",
        howTechnical: "Role trusted from client input or enforced inconsistently.",
        whyVuln: "Assignment and enforcement of roles diverge or live client-side.",
        whyWorked: "Server honoured an attacker-controlled role claim.",
        whyFailed: "Server-derived roles enforced uniformly, deny-by-default.",
        validate: "Perform a privileged action after altering role indicators.",
        fix: "Server-authoritative roles, centralised enforcement, least privilege.",
        report: "Present the matrix, the tampered role, and the escalated action.",
        interview: "Compare RBAC vs ABAC and where enforcement must live.",
      },
    },
    {
      id: "mass-assignment",
      name: "Mass Assignment / Object Injection",
      aliases: ["mass assignment", "autobind", "over-posting", "extra parameter", "isadmin", "object injection"],
      tags: ["access-control", "server-side"],
      simple:
        "The app binds your whole request body onto an object, so you can set fields you were never meant to.",
      example:
        "Adding \"isAdmin\": true to a profile-update request and becoming an admin.",
      identify: [
        "APIs that accept JSON/form bodies mapped onto models.",
        "Objects with sensitive fields (role, balance, verified, owner).",
        "Frameworks with auto-binding defaults.",
      ],
      test: [
        "Add unexpected fields (isAdmin, role, price, userId) and observe.",
        "Compare allowed vs actually-bound fields.",
        "Test read of hidden fields too, not just write.",
      ],
      mistakes: [
        "Only sending fields the UI shows.",
        "Not diffing the object before/after to confirm binding.",
      ],
      senior: [
        "Enumerates the object's full field set, not just the form's.",
        "Thinks about which fields should be server-controlled only.",
      ],
      mental: "If the server binds what you send, send what it forgot to protect.",
      coach: [
        "What object does this request update?",
        "What fields might exist beyond the ones the form shows?",
        "Which of those should ONLY the server be allowed to set?",
      ],
      hints: [
        "Add a plausible privileged field (isAdmin/role/verified) to the JSON body.",
        "Confirm by re-reading the object afterwards.",
      ],
      next: "Ask what the underlying object looks like — not what the form shows.",
      lens: {
        who: "Any user who can submit an object-updating request.",
        what: "Setting server-controlled fields to escalate or tamper.",
        when: "Create/update endpoints that bind request bodies.",
        where: "JSON/form bodies mapped to ORM/model objects.",
        howAssessment: "Enumerate model fields; inject unexpected ones; verify binding.",
        howTechnical: "Auto-binding without an allowlist of writable fields.",
        whyVuln: "The binding layer trusts the whole payload shape.",
        whyWorked: "A sensitive field was writable and got bound.",
        whyFailed: "Explicit allowlist/DTO limited writable fields.",
        validate: "Show a privileged field change taking effect.",
        fix: "Bind via explicit allowlists/DTOs; never auto-bind sensitive fields.",
        report: "Show the extra field and its privileged effect.",
        interview: "Explain mass assignment and allowlist-based binding.",
      },
    },
    {
      id: "ssti",
      name: "SSTI (Server-Side Template Injection)",
      aliases: ["ssti", "template injection", "jinja", "twig", "freemarker", "{{7*7}}"],
      tags: ["injection", "server-side"],
      simple:
        "User input is evaluated by a server template engine, letting you run engine expressions — sometimes full code.",
      example:
        "A name field where {{7*7}} renders as 49.",
      identify: [
        "User input reflected into server-rendered templates.",
        "Math/expression probes evaluating (7*7→49).",
        "Framework hints (Jinja2, Twig, Freemarker, Velocity).",
      ],
      test: [
        "Send a harmless expression probe and check for evaluation.",
        "Fingerprint the engine from behaviour/errors.",
        "Escalate carefully within scope to demonstrate impact.",
      ],
      mistakes: [
        "Confusing SSTI with XSS (server-side eval vs client-side script).",
        "Skipping engine fingerprinting before escalation.",
      ],
      senior: [
        "Confirms evaluation, fingerprints the engine, THEN reasons about capabilities.",
        "Weighs blast radius before any RCE-style proof.",
      ],
      mental: "SSTI means your text is being run as template code on the server.",
      coach: [
        "Is your input being rendered by a template on the server?",
        "What harmless expression would prove it's evaluated?",
        "Which engine is this, and what can it reach?",
      ],
      hints: [
        "Arithmetic probes distinguish evaluation from reflection.",
        "Fingerprint the engine before attempting anything heavier.",
      ],
      next: "Prove evaluation with a benign expression before thinking about impact.",
      lens: {
        who: "An attacker controlling template-rendered input.",
        what: "Executing engine expressions, potentially server code.",
        when: "Any input rendered through a server template.",
        where: "Templated responses, emails, PDFs, dynamic pages.",
        howAssessment: "Confirm eval, fingerprint engine, scope-limited escalation.",
        howTechnical: "Untrusted input concatenated into template source.",
        whyVuln: "Input is compiled/evaluated as template code.",
        whyWorked: "The engine evaluated attacker expressions.",
        whyFailed: "Input treated strictly as data / sandboxed engine.",
        validate: "Benign evaluation proof, then bounded impact demonstration.",
        fix: "Never render user input as template source; use logic-less templates/sandboxing.",
        report: "Show the eval proof, engine, and controlled impact.",
        interview: "Differentiate SSTI from XSS and outline detection.",
      },
    },
    {
      id: "path-traversal",
      name: "Path Traversal / LFI",
      aliases: ["path traversal", "directory traversal", "lfi", "local file inclusion", "../", "file parameter"],
      tags: ["injection", "server-side"],
      simple:
        "A file path built from your input lets you step out of the intended folder to read other files.",
      example:
        "?file=../../../../etc/passwd returning the system's user list.",
      identify: [
        "Parameters naming a file/path/template/page.",
        "Downloads, includes, image loaders using user input.",
        "Behaviour changing with ../ sequences or absolute paths.",
      ],
      test: [
        "Try traversal sequences and encodings against a file parameter.",
        "Target known-safe files to prove read (in scope).",
        "Consider filter bypasses (encoding, null bytes, absolute paths).",
      ],
      mistakes: [
        "Only trying one ../ depth.",
        "Ignoring encoding-based filter bypasses.",
      ],
      senior: [
        "Reasons about how the path is assembled server-side.",
        "Thinks read → include → potential code execution chains.",
      ],
      mental: "Any user-built file path is a map out of the sandbox — follow the ../.",
      coach: [
        "How is the final file path assembled from your input?",
        "What would stepping up a directory reveal?",
        "What filtering stands between your input and the filesystem?",
      ],
      hints: [
        "Vary traversal depth and try encoded ../ forms.",
        "Prove with a benign, known file before anything sensitive.",
      ],
      next: "Find the parameter that names a file, then reason about how the path is built.",
      lens: {
        who: "An attacker controlling a file/path parameter.",
        what: "Reading (or including) arbitrary server files.",
        when: "Any request assembling a filesystem path from input.",
        where: "Download/view/include/template parameters.",
        howAssessment: "Probe traversal + encodings; prove with safe files; test filters.",
        howTechnical: "User input concatenated into a filesystem path without canonicalisation.",
        whyVuln: "The path boundary isn't enforced after normalisation.",
        whyWorked: "Traversal escaped the intended directory.",
        whyFailed: "Canonicalisation + allowlist confined access.",
        validate: "Read a benign out-of-scope-safe file to prove traversal.",
        fix: "Canonicalise and validate against an allowlist; avoid user paths entirely.",
        report: "Show the parameter, the traversal, and the file exposed.",
        interview: "Explain traversal vs LFI/RFI and canonicalisation defenses.",
      },
    },
    {
      id: "command-injection",
      name: "OS Command Injection",
      aliases: ["command injection", "os command", "rce", "shell injection", "; ls", "backtick"],
      tags: ["injection", "server-side"],
      simple:
        "Your input is placed into a shell command, letting you append or alter commands the server runs.",
      example:
        "A ping tool where 127.0.0.1; id runs the id command.",
      identify: [
        "Features shelling out (ping, nslookup, convert, zip, backup).",
        "Timing/output changes with shell metacharacters.",
        "Errors hinting at a shell.",
      ],
      test: [
        "Use time-based or OOB probes to confirm execution.",
        "Test separators/metacharacters carefully.",
        "Keep proofs benign and in scope.",
      ],
      mistakes: [
        "Assuming no output = not vulnerable (try blind/OOB).",
        "Using destructive commands to 'prove' it.",
      ],
      senior: [
        "Prefers blind/time/OOB confirmation over noisy commands.",
        "Thinks about command context and quoting.",
      ],
      mental: "If input reaches a shell, punctuation is power — separators chain commands.",
      coach: [
        "Does this feature run a system command behind the scenes?",
        "What character would end one command and start another?",
        "If you can't see output, how do you confirm execution?",
      ],
      hints: [
        "A time delay or DNS/HTTP callback confirms blind command injection.",
        "Keep it to a harmless id/sleep in scope.",
      ],
      next: "Spot features that likely shell out, then confirm execution the quiet way.",
      lens: {
        who: "An attacker controlling input passed to a shell.",
        what: "Executing arbitrary OS commands on the server.",
        when: "Any input reaching a system/shell call.",
        where: "Utilities that shell out (network tools, converters, exports).",
        howAssessment: "Time-based/OOB confirmation, careful metacharacter testing.",
        howTechnical: "Input concatenated into a shell invocation.",
        whyVuln: "Data and command share the shell's parsing.",
        whyWorked: "Metacharacters let input become new commands.",
        whyFailed: "No shell used / strict argument arrays / allowlists.",
        validate: "Benign, evidence-based execution proof (timing/OOB).",
        fix: "Avoid shells; use safe APIs with argument arrays; strict allowlists.",
        report: "Show the injectable input and quiet proof of execution.",
        interview: "Explain why arg-array APIs beat escaping.",
      },
    },
    {
      id: "xxe",
      name: "XXE (XML External Entity)",
      aliases: ["xxe", "xml external entity", "doctype", "entity", "xml parser"],
      tags: ["injection", "server-side"],
      simple:
        "An XML parser that resolves external entities lets you read files or make the server send requests.",
      example:
        "An XML upload defining an entity that reads file:///etc/passwd.",
      identify: [
        "Endpoints accepting XML (SOAP, SAML, docx/svg, config uploads).",
        "Parsers that may resolve DOCTYPE/entities.",
        "Reflected parsed content or OOB behaviour.",
      ],
      test: [
        "Test entity resolution with benign in-band or OOB payloads.",
        "Consider blind XXE via out-of-band channels.",
        "Look for XML hidden inside other formats.",
      ],
      mistakes: [
        "Only thinking of literal .xml and missing SAML/SVG/docx.",
        "Giving up when output isn't reflected (try OOB).",
      ],
      senior: [
        "Hunts every XML entry point, including embedded ones.",
        "Uses OOB to confirm blind XXE.",
      ],
      mental: "XXE is trust in an XML parser that reads more than data — it fetches.",
      coach: [
        "Where does the app parse XML — even indirectly?",
        "Does that parser resolve external entities?",
        "If nothing reflects back, how do you confirm it?",
      ],
      hints: [
        "SAML, SVG, and Office docs are XML too.",
        "Blind XXE? Use an OOB callback to confirm resolution.",
      ],
      next: "Inventory every XML entry point — many are disguised — before testing entities.",
      lens: {
        who: "An attacker submitting XML to a permissive parser.",
        what: "Reading files, SSRF, or DoS via entity resolution.",
        when: "Any XML-parsing endpoint.",
        where: "SOAP/SAML, file uploads (svg/docx), config imports.",
        howAssessment: "Test entity resolution in-band and OOB; find hidden XML.",
        howTechnical: "Parser resolves external/general entities on untrusted input.",
        whyVuln: "The parser is trusted to fetch/expand references.",
        whyWorked: "External entity resolution was enabled.",
        whyFailed: "Entity resolution and DOCTYPE disabled.",
        validate: "Confirm file read or OOB fetch within scope.",
        fix: "Disable DTD/external entities; use hardened parser configs.",
        report: "Show the XML entry point and the resolved resource.",
        interview: "Explain XXE variants and secure parser configuration.",
      },
    },
    {
      id: "file-upload",
      name: "Insecure File Upload",
      aliases: ["file upload", "upload", "content-type", "webshell", "avatar upload", "multipart"],
      tags: ["server-side"],
      simple:
        "Uploads validated weakly (by extension or client-sent type) can smuggle dangerous files or content.",
      example:
        "Uploading shell.php as an 'avatar' because only the client-supplied type was checked.",
      identify: [
        "Any upload feature (avatar, document, import).",
        "Validation based on extension or client Content-Type.",
        "Where uploads are stored and whether they're served/executed.",
      ],
      test: [
        "Test extension/content-type/magic-byte handling.",
        "Check storage location and execution/serving behaviour.",
        "Consider path/name control and overwrite.",
      ],
      mistakes: [
        "Only checking if a bad extension is blocked, not how the file is served.",
        "Ignoring content-type vs real content mismatch.",
      ],
      senior: [
        "Cares as much about STORAGE/serving as about validation.",
        "Chains upload with traversal, XSS (svg/html), or SSRF.",
      ],
      mental: "An upload is trusted input that becomes a stored, sometimes-executable file.",
      coach: [
        "What decides whether this file is 'allowed'?",
        "Where does the file end up, and can it be executed or served?",
        "Could the filename or content itself be an attack?",
      ],
      hints: [
        "Mismatch extension vs content vs magic bytes to probe validation.",
        "An SVG/HTML upload served inline can mean stored XSS.",
      ],
      next: "Ask both 'what's validated?' and 'where does it live and get served?'",
      lens: {
        who: "Any user who can upload a file.",
        what: "Storing executable/malicious content or overwriting files.",
        when: "On upload and on later retrieval/serving.",
        where: "Upload endpoints and their storage/serving path.",
        howAssessment: "Probe validation layers; analyse storage/serving; chain vulns.",
        howTechnical: "Weak validation + unsafe storage/execution of uploads.",
        whyVuln: "Untrusted files are trusted at write or serve time.",
        whyWorked: "Validation was bypassable and storage allowed execution/inline serving.",
        whyFailed: "Strong type checks, randomised names, isolated non-exec storage.",
        validate: "Show a smuggled file executing or being served dangerously.",
        fix: "Validate content, store outside webroot, randomise names, serve as attachments.",
        report: "Show the bypass and the dangerous storage/serving outcome.",
        interview: "List upload defenses beyond extension checks.",
      },
    },
    {
      id: "open-redirect",
      name: "Open Redirect",
      aliases: ["open redirect", "redirect", "returnurl", "next=", "url parameter redirect"],
      tags: ["client-side", "auth"],
      simple:
        "A redirect target taken from user input lets an attacker bounce victims to a malicious site under your domain's trust.",
      example:
        "/login?next=//evil.example sending users off-site after login.",
      identify: [
        "Parameters like next, returnUrl, redirect, url, dest.",
        "Server- or client-side redirects using them.",
        "Loose validation of the target.",
      ],
      test: [
        "Supply external/protocol-relative targets and observe.",
        "Test bypasses (//host, whitelisted-substring tricks).",
        "Assess chaining with OAuth/token leakage or phishing.",
      ],
      mistakes: [
        "Dismissing it as low impact without considering OAuth/token chains.",
        "Missing protocol-relative // bypasses.",
      ],
      senior: [
        "Values it as a chaining primitive (OAuth code theft, phishing).",
        "Tests validation bypasses methodically.",
      ],
      mental: "Open redirect borrows your domain's trust to point somewhere it shouldn't.",
      coach: [
        "Where does the redirect target come from?",
        "How is that target validated?",
        "What bigger attack could a redirect enable?",
      ],
      hints: [
        "Protocol-relative //evil.example often slips past naive checks.",
        "Think about how it amplifies OAuth or phishing.",
      ],
      next: "Find the redirect parameter, then test how loosely its target is validated.",
      lens: {
        who: "Victims following a trusted-looking link.",
        what: "Redirecting users off-site, enabling phishing/token theft.",
        when: "On any user-controlled redirect.",
        where: "next/returnUrl/redirect parameters.",
        howAssessment: "Test external/relative targets and bypasses; assess chains.",
        howTechnical: "Redirect target derived from unvalidated input.",
        whyVuln: "The app's trust is lent to an attacker-chosen destination.",
        whyWorked: "Validation allowed an external/relative target.",
        whyFailed: "Allowlist of internal targets / relative-only redirects.",
        validate: "Show a redirect to an attacker-controlled destination.",
        fix: "Allowlist targets or use server-mapped keys, not raw URLs.",
        report: "Show the parameter, the off-site redirect, and any chain.",
        interview: "Explain why open redirect matters despite seeming minor.",
      },
    },
    {
      id: "cors",
      name: "CORS Misconfiguration",
      aliases: ["cors", "access-control-allow-origin", "acao", "cross-origin", "preflight"],
      tags: ["client-side", "server-side"],
      simple:
        "Overly permissive cross-origin rules let a malicious site read authenticated responses from your API.",
      example:
        "An API reflecting any Origin AND allowing credentials, so attacker.example reads user data.",
      identify: [
        "Access-Control-Allow-Origin behaviour (reflected? wildcard?).",
        "Whether Allow-Credentials is true.",
        "Sensitive data on credentialed cross-origin endpoints.",
      ],
      test: [
        "Vary the Origin header and inspect ACAO/ACAC responses.",
        "Check null-origin and subdomain trust handling.",
        "Confirm actual cross-origin readability of sensitive data.",
      ],
      mistakes: [
        "Assuming a wildcard ACAO always means exploitable (credentials matter).",
        "Not verifying data is actually sensitive.",
      ],
      senior: [
        "Focuses on Origin-reflection + credentials + sensitive data together.",
        "Tests null origin and trusted-subdomain pivots.",
      ],
      mental: "CORS decides who may READ your responses cross-origin — misconfig = data leak.",
      coach: [
        "Which origins is this API willing to share responses with?",
        "Does it also allow credentials?",
        "Is the data behind it actually sensitive?",
      ],
      hints: [
        "Reflected Origin + Allow-Credentials: true is the dangerous combo.",
        "Test a null origin and any trusted subdomains.",
      ],
      next: "Send different Origin values and read the ACAO/ACAC headers back.",
      lens: {
        who: "A malicious site targeting a logged-in victim.",
        what: "Reading authenticated cross-origin responses.",
        when: "On credentialed cross-origin requests.",
        where: "CORS response headers on sensitive APIs.",
        howAssessment: "Vary Origin; inspect ACAO/ACAC; confirm readability.",
        howTechnical: "Reflected/over-broad origins combined with credentials.",
        whyVuln: "The API trusts arbitrary origins to read credentialed data.",
        whyWorked: "Origin reflection + Allow-Credentials exposed responses.",
        whyFailed: "Strict origin allowlist; credentials disabled for cross-origin.",
        validate: "Show cross-origin read of sensitive data in a controlled PoC.",
        fix: "Strict origin allowlist; avoid reflecting Origin; scope credentials tightly.",
        report: "Show the header behaviour and the cross-origin data read.",
        interview: "Explain the Origin-reflection + credentials pitfall.",
      },
    },
    {
      id: "business-logic",
      name: "Business Logic Flaws",
      aliases: ["business logic", "logic flaw", "workflow", "price manipulation", "negative quantity", "state machine"],
      tags: ["logic"],
      simple:
        "The code works as written, but the rules of the business can be abused — order of steps, quantities, prices, limits.",
      example:
        "Setting a negative quantity to reduce the total, or skipping a payment step.",
      identify: [
        "Multi-step workflows (checkout, transfer, onboarding).",
        "Values that carry meaning (price, quantity, status, coupon).",
        "Assumptions about order and state.",
      ],
      test: [
        "Map the intended workflow and each state transition.",
        "Break assumptions: skip steps, replay, use extreme/negative values.",
        "Test client-trusted values (price, discount) server-side.",
      ],
      mistakes: [
        "Only looking for 'technical' vulns and missing rule abuse.",
        "Not modelling the intended workflow first.",
      ],
      senior: [
        "Understands the business goal, then finds where trust in the user is misplaced.",
        "Thinks in state machines and invariants.",
      ],
      mental: "Logic bugs aren't broken code — they're broken assumptions about the user.",
      coach: [
        "What is this workflow trying to guarantee?",
        "Which step assumes the previous one happened honestly?",
        "What value does the app trust the client to send truthfully?",
      ],
      hints: [
        "Try skipping, reordering, or replaying steps.",
        "Push values to extremes: zero, negative, huge, someone else's.",
      ],
      next: "Model the intended workflow first; attack the assumptions between steps.",
      lens: {
        who: "A user who understands the workflow better than the code assumes.",
        what: "Abusing rules: prices, limits, ordering, entitlements.",
        when: "Across multi-step or value-bearing flows.",
        where: "Checkout, transfers, quotas, approvals, coupons.",
        howAssessment: "Model the state machine; break ordering/quantity/price assumptions.",
        howTechnical: "Server trusts client-supplied meaning or step ordering.",
        whyVuln: "Invariants aren't enforced server-side.",
        whyWorked: "The app assumed honest input or sequencing.",
        whyFailed: "Server-enforced invariants and authoritative values.",
        validate: "Demonstrate a concrete unintended business outcome.",
        fix: "Enforce invariants server-side; never trust client-supplied meaning.",
        report: "Show the workflow, the broken assumption, and the impact.",
        interview: "Explain why logic flaws evade scanners and need modelling.",
      },
    },
    {
      id: "rate-limit",
      name: "Rate Limiting / Brute Force / Enumeration",
      aliases: ["rate limit", "brute force", "brute-force", "brute-forcing", "brute forcing", "credential stuffing", "enumeration", "user enumeration", "username enumeration", "account enumeration", "usernames", "username", "otp bypass", "password spraying", "login attempts", "account lockout"],
      tags: ["auth", "logic"],
      simple:
        "Without limits, attackers can guess credentials, tokens, or enumerate valid users/objects at scale.",
      example:
        "An OTP with no attempt limit, or a login that says 'no such user' vs 'wrong password'.",
      identify: [
        "Login, OTP, password reset, promo, or lookup endpoints.",
        "Distinguishable responses for valid vs invalid.",
        "Absence of lockout/throttling.",
      ],
      test: [
        "Check for throttling/lockout on sensitive endpoints.",
        "Look for response differences enabling enumeration.",
        "Assess OTP/token guess space and reset flows.",
      ],
      mistakes: [
        "Ignoring subtle response/timing differences.",
        "Only testing login and not reset/OTP/lookup.",
      ],
      senior: [
        "Thinks about the whole guessable surface and oracle signals.",
        "Considers distributed and header-based bypasses.",
      ],
      mental: "No limit + an oracle = attackers get infinite tries and a hint each time.",
      coach: [
        "How many attempts does this endpoint allow before stopping you?",
        "Does the response reveal whether a value was valid?",
        "How large is the space you'd have to guess?",
      ],
      hints: [
        "Compare valid vs invalid responses (text, code, timing) for an oracle.",
        "OTP/reset flows are often the weakest — check attempt limits.",
      ],
      next: "For each sensitive endpoint ask: how many guesses, and what does each reveal?",
      lens: {
        who: "An attacker automating guesses/enumeration.",
        what: "Cracking credentials/tokens or enumerating users/objects.",
        when: "On any guessable, high-value endpoint.",
        where: "Login, OTP, reset, lookup, promo endpoints.",
        howAssessment: "Test throttling/lockout; hunt oracles; size the guess space.",
        howTechnical: "No/weak rate limiting plus distinguishable responses.",
        whyVuln: "Unlimited attempts + information leakage enable brute force.",
        whyWorked: "No lockout and a valid/invalid oracle existed.",
        whyFailed: "Throttling, lockout, uniform responses, large token space.",
        validate: "Demonstrate enumeration or feasible brute force within scope.",
        fix: "Rate limit + lockout, uniform responses, strong tokens, monitoring.",
        report: "Show the missing limit and the oracle enabling attack.",
        interview: "Explain enumeration oracles and layered anti-automation.",
      },
    },
    {
      id: "deserialization",
      name: "Insecure Deserialization",
      aliases: ["deserialization", "deserialisation", "serialized object", "pickle", "java serial", "gadget chain"],
      tags: ["injection", "server-side"],
      simple:
        "The app rebuilds objects from untrusted serialized data, which can trigger dangerous code paths.",
      example:
        "A serialized cookie the server unpickles, enabling object-injection/RCE via gadgets.",
      identify: [
        "Serialized blobs in cookies, params, or bodies (base64 of binary).",
        "Language-specific markers (Java AC ED, PHP O:, Python pickle).",
        "Server rebuilding objects from that data.",
      ],
      test: [
        "Identify the format and whether it's user-controlled.",
        "Assess whether native deserialization is used on untrusted input.",
        "Reason about gadget availability (carefully, in scope).",
      ],
      mistakes: [
        "Missing serialized data hidden as base64.",
        "Underestimating impact (often RCE).",
      ],
      senior: [
        "Recognises formats fast and reasons about type/gadget exposure.",
        "Treats native-deserialization-of-untrusted-input as high severity.",
      ],
      mental: "Deserialization rebuilds attacker data into live objects — data becomes behaviour.",
      coach: [
        "Is this blob a serialized object, and can you control it?",
        "Does the server deserialize it natively?",
        "What class/gadget surface does that expose?",
      ],
      hints: [
        "Look for language markers under base64.",
        "Native deserialization of untrusted input is a red flag on its own.",
      ],
      next: "Fingerprint the blob's format first; then ask if it's natively deserialized.",
      lens: {
        who: "An attacker controlling serialized input.",
        what: "Object injection, tampering, or RCE via gadget chains.",
        when: "Whenever untrusted serialized data is deserialized.",
        where: "Cookies, tokens, params, message queues.",
        howAssessment: "Fingerprint format; confirm native deserialization; reason about gadgets.",
        howTechnical: "Native deserialization of attacker-controlled data.",
        whyVuln: "Deserialization reconstructs behaviour, not just data.",
        whyWorked: "Untrusted data was deserialized into exploitable objects.",
        whyFailed: "No native deserialization / signed, typed, allowlisted formats.",
        validate: "Demonstrate controlled impact within authorised scope.",
        fix: "Avoid native deserialization; use signed, typed, allowlisted data formats.",
        report: "Show the controllable blob and the resulting behaviour.",
        interview: "Explain gadget chains and safe serialization practices.",
      },
    },
    {
      id: "trust-boundary",
      name: "Trust Boundaries (Core Mindset)",
      aliases: ["trust boundary", "trust boundaries", "attack surface", "input validation", "threat model"],
      tags: ["mindset"],
      simple:
        "A trust boundary is any line where data crosses from a less-trusted zone to a more-trusted one. Bugs cluster there.",
      example:
        "Browser→server, server→database, service→service, user→admin — each crossing needs a check.",
      identify: [
        "Where does external input enter the system?",
        "Where does one component start trusting another's data?",
        "Which checks live at each crossing?",
      ],
      test: [
        "Enumerate inputs and boundaries before touching payloads.",
        "At each crossing, ask what is validated and by whom.",
        "Look for validation done on the wrong side of the line.",
      ],
      mistakes: [
        "Jumping to payloads before mapping the surface.",
        "Assuming an internal component's data is automatically safe.",
      ],
      senior: [
        "Starts every assessment by drawing boundaries and data flows.",
        "Treats every crossing as a place validation might be missing.",
      ],
      mental: "Business → App → Workflow → Objects → Trust boundaries → Hypothesis → Test → Evidence.",
      coach: [
        "Where does untrusted data enter here?",
        "Which side of the boundary performs the check?",
        "What is being trusted that maybe shouldn't be?",
      ],
      hints: [
        "Map inputs and crossings first; vulnerabilities live at the seams.",
        "Ask 'who validates this, and are they on the trusted side?'",
      ],
      next: "Before any payload: map the boundaries and where validation should live.",
      lens: {
        who: "Any actor supplying data that crosses into a trusted zone.",
        what: "Exploiting missing/misplaced validation at a crossing.",
        when: "At every data hand-off between trust zones.",
        where: "Client↔server, server↔DB, service↔service, role↔role.",
        howAssessment: "Diagram data flow, mark boundaries, audit checks at each.",
        howTechnical: "Validation absent or performed on the untrusted side.",
        whyVuln: "Trust was extended across a boundary without verification.",
        whyWorked: "A crossing lacked (server-side) validation.",
        whyFailed: "Each boundary validated authoritatively on the trusted side.",
        validate: "Show data crossing a boundary unchecked to cause impact.",
        fix: "Validate at every trust boundary, authoritatively, on the trusted side.",
        report: "Frame the finding around the specific boundary that failed.",
        interview: "Describe how you map trust boundaries at the start of an assessment.",
      },
    },
  ];

  // Build a fast alias→concept index for detection and highlight lookups.
  const INDEX = [];
  for (const c of K) {
    const terms = new Set([c.name.toLowerCase(), ...c.aliases.map((a) => a.toLowerCase())]);
    INDEX.push({ concept: c, terms: [...terms] });
  }

  WPC.KNOWLEDGE = K;
  WPC.getConcept = (id) => K.find((c) => c.id === id) || null;

  /**
   * Detect concepts present in a blob of text, ranked by match strength.
   * @param {string} text
   * @param {number} [limit]
   */
  WPC.detectConcepts = function (text, limit) {
    const hay = " " + String(text || "").toLowerCase() + " ";
    const scored = [];
    for (const entry of INDEX) {
      let score = 0;
      const hitTerms = [];
      for (const t of entry.terms) {
        if (t.length < 3) continue;
        // word-ish boundary match
        const re = new RegExp("(^|[^a-z0-9])" + escapeRe(t) + "([^a-z0-9]|$)", "i");
        if (re.test(hay)) {
          score += t.length > 6 ? 3 : 2;
          hitTerms.push(t);
        }
      }
      if (score > 0) scored.push({ concept: entry.concept, score, hitTerms });
    }
    scored.sort((a, b) => b.score - a.score);
    return limit ? scored.slice(0, limit) : scored;
  };

  /**
   * Detect concepts for an extracted page context, weighting the title and
   * headings far above body text so the page's actual TOPIC dominates (a
   * stray word in a paragraph shouldn't outvote the <h1>).
   */
  WPC.detectConceptsForContext = function (ctx, limit) {
    if (!ctx) return [];
    const title = ctx.title || "";
    const heads = (ctx.headers || []).map((h) => (h && h.text) || h || "").join("  ");
    const paras = (ctx.paragraphs || []).join("  ");
    // title ×4, headings ×2, body ×1
    const weighted = [title, title, title, title, heads, heads, paras].join("  \n  ");
    return WPC.detectConcepts(weighted, limit);
  };

  /** Find the single best concept for a highlighted phrase (Concept Mode). */
  WPC.lookupConcept = function (phrase) {
    const found = WPC.detectConcepts(phrase, 1);
    return found.length ? found[0].concept : null;
  };

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
})();
