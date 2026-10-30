# GitHub login setup

The editor now uses GitHub sign-in instead of pasted personal access tokens.
Deploy the Worker and static editor together so cookies and API requests share an
origin. GitHub Pages alone cannot run the OAuth callback. Existing Actions,
TRMNL webhook, images, presets, and schedule storage remain in GitHub.

## One-time deployment

1. Sign in to Cloudflare and install Node.js 22+ and Wrangler. From this repository,
   run `npx wrangler login`, then `npx wrangler kv namespace create SESSIONS`.
   Put the returned namespace ID in `wrangler.toml`.
2. Choose the Worker address (or a custom domain) and put its exact HTTPS origin,
   without a trailing slash, in `APP_ORIGIN`. Deploy initially with
   `npx wrangler deploy` to confirm the address. Login stays unavailable until
   the settings below are complete.
3. In [GitHub OAuth apps](https://github.com/settings/developers), register a new
   OAuth app named **Gilkey TRMNL Office Status**. Set its homepage to the Worker
   origin and its callback to `https://YOUR-WORKER-ADDRESS/auth/callback`.
   Put its client ID in `GITHUB_CLIENT_ID` in `wrangler.toml`.
4. Generate the OAuth client secret and store it using
   `npx wrangler secret put GITHUB_CLIENT_SECRET`. Paste it into that command's
   private prompt. Never commit the secret or put it in browser JavaScript.
5. Keep `ALLOWED_GITHUB_ID = "252633601"` for gky501. This numeric account ID
   prevents other GitHub users from operating the sign.
6. Run `npx wrangler deploy`, open the Worker URL, and click **Sign in with GitHub**.
   Authorize the app, send a test sign, confirm the Actions run, and save and remove
   a test schedule. Update your bookmarks to this URL. The old Pages site can
   still preview/download signs but cannot sign in.

The OAuth app requests `public_repo` to dispatch Actions and update schedules in
this public repository. GitHub OAuth scopes apply across your public repositories;
the server forwards only the specific workflow and schedule operations for
`gky501/TRMNL-Office-Status`. Private-repository access is not requested.

## Sessions and operations

GitHub access tokens live in the private Cloudflare KV namespace, never in browser
storage or API responses. Keep Cloudflare account access restricted. Sessions last
seven days, are invalidated on sign-out, and use Secure, HttpOnly, SameSite cookies.
KV is eventually consistent: a session can take up to roughly a minute to appear
or disappear across regions. Retry briefly if login has just completed. For an
immediate credential revocation, revoke the OAuth app in GitHub settings.

OAuth state and PKCE bind the callback to the initiating browser. Mutating API
requests require the app's exact Origin. The service has no cross-origin API and
cannot forward arbitrary GitHub URLs. Login failures show a retry message; account
rejection never creates a session. Preview, drafts, presets, and downloads work
without login. Sending and scheduling require an active session.

For local preview without authentication, serve `docs` as before. For full login
use an HTTPS development Worker with its own OAuth app and matching callback URL;
production Secure cookies are intentionally not weakened for HTTP development.

Run `node tests/auth.mjs` for mocked authentication/security checks and `pnpm test`
for all browser checks. These do not contact GitHub or update TRMNL.

References: [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps),
[Worker static assets](https://developers.cloudflare.com/workers/static-assets/binding/).
