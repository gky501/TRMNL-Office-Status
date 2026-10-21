# TRMNL Office Status

Create custom office signs with a headline, subline, extra note, contact options,
and a light or dark appearance. The live preview fits text automatically and
exports an 800 × 480 PNG. Built-in presets provide starting points; personal
presets and your unfinished draft are saved in this browser. Signs use a compact
footer and an open headline area, without the old vertical bar.

## Set up

1. Merge the editor and workflow changes into `main`. Keep GitHub Pages configured
   to serve the `docs` folder on `main`.
2. Keep the repository secret `TRMNL_WEBHOOK_URL` set to your TRMNL private plugin's
   webhook URL. Its existing template must display `image_url`; no template change
   is needed if sending custom signs already works.
3. Allow GitHub Actions to write repository contents. Custom signs are committed
   to the `trmnl-rendered` branch using the workflow's built-in token. Branch rules
   must allow this branch to be created and updated by Actions.
4. Open the Pages site and unlock it with a GitHub token that has **Actions: write**
   permission for this repository. Add **Contents: read and write** to save and
   manage schedules. The token stays in this browser until you click **Lock**.
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
`main` or trigger Pages deployments.
GitHub concurrency can replace an older pending run when several are queued;
avoid sending multiple updates before the previous workflow finishes.

## Development

Requires Node.js 22+, pnpm 10, and Python 3.9+ with timezone data. Run `corepack enable`, `pnpm install --frozen-lockfile`, then
`pnpm exec playwright install chromium`. Run `pnpm test` for browser checks, and
`python3 -m unittest discover -s tests` for publishing and scheduler checks.

Preview locally with `python3 -m http.server 8000 --directory docs` and open
`http://localhost:8000`. To generate a PNG locally:

```sh
STATUS_JSON='{"message":"IN A MEETING","subline":"BACK AT 2:30 PM","note":"Please send a message","contacts":["Teams","Email"]}' pnpm run render
```

Publishing and actual device refresh require the configured GitHub repository and
TRMNL webhook. Automated tests mock outgoing requests and do not update the device.

## Scheduling

The **Set it and go** panel saves a copy of the currently edited sign. Choose a
one-time date or a repeating weekly pattern, select the time and timezone, and
click **Schedule this sign**. Central time (`America/Chicago`) is the default.
You can edit, pause, resume, or delete saved schedules from any browser after
unlocking. Editing a schedule loads its sign into the editor above. Later changes
to a preset or draft do not change an existing schedule.

Schedule storage lives in `schedules.json` on the dedicated `trmnl-schedules`
branch. The editor creates this branch on the first save. Your fine-grained GitHub
token now also needs **Contents: read and write** for this repository, alongside
**Actions: write** for immediate sends. The workflow uses its own built-in token;
your browser token is never saved in the schedule document. Branch rules must
allow updates to `trmnl-schedules` as well as `trmnl-rendered`.

Merge the scheduling workflow into `main` and leave GitHub Actions enabled. No
additional service or secret is needed. The existing TRMNL webhook is reused.
Schedules are checked about every five minutes even with the browser closed.
GitHub may delay or skip scheduled runs, and TRMNL has its own refresh interval;
this feature does not promise exact-minute delivery. Use **View schedule activity**
for actual run results. [GitHub can disable](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) scheduled workflows in public
repositories after 60 days without repository activity; re-enable the workflow in
Actions if that happens.

Weekly times follow the selected timezone's daylight-saving rules. A time skipped
by the spring clock change is skipped that week; a repeated fall time runs only
once, at its first occurrence. One-time repeated times also use the first
occurrence. The browser rejects nonexistent one-time local times.

If runs are delayed, only the newest due sign within the past 24 hours is sent;
earlier due signs are marked as superseded after that send succeeds. Simultaneous
entries are resolved consistently by their schedule ID. Older one-time changes
expire; edit their date to reschedule. New or resumed weekly schedules start from
the time they are saved and do not replay earlier changes. If a send fails, it is
retried by the next scheduled check while still within the 24-hour window. If a
send succeeds but recording the result fails, it may be delivered again. Immediate sends
do not pause schedules; a due scheduled change can replace them.

Schedules and messages are public in this public repository. The editor uses file
revision checks to prevent overwriting concurrent saves. The runner records send
results without replacing schedules edited or deleted while it was running.

The runner rechecks the selected schedule just before sending, so a pause, deletion,
or newer due status detected during rendering defers the update to the next check.
