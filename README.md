# TRMNL Office Status

Create custom office signs with a headline, subline, extra note, contact options,
and a light or dark appearance. The live preview fits text automatically and
exports an 800 × 480 PNG. Built-in presets provide starting points; personal
presets and your unfinished draft are saved in this browser. The original image
library remains available below the editor.

## Set up

1. Merge the editor and workflow changes into `main`. Keep GitHub Pages configured
   to serve the `docs` folder on `main`.
2. Keep the repository secret `TRMNL_WEBHOOK_URL` set to your TRMNL private plugin's
   webhook URL. Its existing template must display `image_url`; no template change
   is needed if the image picker already works.
3. Allow GitHub Actions to write repository contents. Custom signs are committed
   to the `trmnl-rendered` branch using the workflow's built-in token. Branch rules
   must allow this branch to be created and updated by Actions.
4. Open the Pages site and unlock it with a GitHub token that has **Actions: write**
   permission for this repository. The token is stored in this browser until you
   click **Lock**, as in the original picker. Use this on a trusted browser.
5. Choose a preset, edit the text, and click **Send to TRMNL**. Follow **View update
   progress** to confirm the workflow succeeded. A queued workflow is not yet a
   device update. The device changes after the webhook succeeds and TRMNL refreshes.

Custom signs and their text are public images in this public repository, including
in Git history. Presets remain on the browser where you saved them. Downloads work
without unlocking or sending. Browser font rendering can vary slightly from the
Linux workflow; both use the same canvas layout and fitting code.

The workflow sends the generated PNG through the existing `image_url` merge
variable. URLs include a commit SHA so each sign has an immutable URL and avoids
stale image caches. Custom updates go to a separate branch and do not modify
`main` or trigger Pages deployments. Image selections use the same workflow.
GitHub concurrency can replace an older pending run when several are queued;
avoid sending multiple updates before the previous workflow finishes.

## Development

Requires Node.js 22+ and Python 3. Run `corepack enable`, `pnpm install --frozen-lockfile`, then
`pnpm exec playwright install chromium`. Run `pnpm test` for browser checks, and
`python3 -m unittest discover -s tests` for publishing checks.

Preview locally with `python3 -m http.server 8000 --directory docs` and open
`http://localhost:8000`. To generate a PNG locally:

```sh
STATUS_JSON='{"message":"IN A MEETING","subline":"BACK AT 2:30 PM","note":"Please send a message","contacts":["Teams","Email"]}' pnpm run render
```

Publishing and actual device refresh require the configured GitHub repository and
TRMNL webhook. Automated tests mock outgoing requests and do not update the device.
