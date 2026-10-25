This directory is for scripts used by the CI for deployment, etc.

### cdn_deploy.js

Deploys correctly versioned code and source maps to the CDN.

Arguments:

- **--bucket**: The S3 bucket name to deploy to, defaults to `prod-cdn.ably.com`.
- **--root**: The base directory inside the bucket to deploy to, defaults to `lib`.
- **--path**: The local path to retrieve source files from. Defaults to `.`.
- **--includeDirs**: A comma separated list of directories to include. Defaults to `.`.
- **--excludeDirs**: A comma separated list of directories to exclude. Defaults to `node_modules,.git`.
- **--fileRegex**: A regular expression to test file names against for upload. Defaults to `^(?!\.).*\.(map|js|html)$`.
- **--skipCheckout**: Optional. Skip checking out the branch before running.

#### AWS Access

Expects AWS access to be configured in the surrounding environment. To run
locally, first set some temporary AWS credentials as environment variables
using `ably-env`:

```
source <(ably-env secrets print-aws)
```

See [AWS Access](https://ably.atlassian.net/wiki/spaces/ENG/pages/665190401/AWS+Access)
for more information about gaining access to AWS.

### checkDocLinks.ts

Verifies every `ably.com/docs` URL referenced from `ably.d.ts`, `modular.d.ts` and `src/`:
that the page still resolves, and that a URL carrying a fragment still matches an element
id on the page it resolves to. A stale fragment is the failure worth catching, since a
browser given an unknown fragment silently leaves the reader at the top of the page.

Run with `npm run check-doc-links`. It takes about a minute: the docs site rate-limits
bursts, so pages are fetched one at a time.

A URL that is known to be broken and cannot be fixed immediately can be listed in the
script's `KNOWN_BROKEN` map, so that the check gates new breakage rather than blocking on a
backlog. Fixing one means deleting its entry — a listed URL that starts working is reported
as a failure telling you to remove it. The map is currently empty.
