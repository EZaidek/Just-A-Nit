# Just-A-Nit

A React + TypeScript web application, built with Vite, for practicing merge request reviews using small, real pull requests from public GitHub repositories.

Licensed under the [MIT License](LICENSE).

Node.js, npm, and the web server run inside Linux containers. You only need Docker Engine (or Docker Desktop) and Docker Compose v2 on your computer.

## Get a code review

Open the application, choose your **Review preferences**, and click **Get a code review**. Defaults remain **1–20 added or removed lines across one or two source files**. Click **Get another code review** for a different example.

- **Review size:** set minimum and maximum changed lines (1–500) and changed files (1–10). Lines are additions plus deletions; a replaced line counts as two changes. Limits apply to the whole PR.
- **Languages:** choose any combination from 34 common languages, including Python, C, C++, TypeScript, JavaScript, Java, C#, Rust, Go, Swift, Kotlin, and SQL. No selection means any supported language. Each changed file must match one of the selected languages by extension; ambiguous extensions such as `.h` can match multiple languages.
- **Repository tags:** choose topics suggested from live GitHub repository metadata, or enter a topic name. Up to five tags can be selected, and the repository must have **all** of them. For example, Vite has `build-tool`, `dev-server`, `frontend`, `hmr`, and `vite`. Topics describe the whole repository, independently of branches; only merged PRs targeting its current default branch are searched.

Preferences are saved locally in the browser and restored on reload. **Reset preferences** restores the defaults. Changing preferences affects the next fetched review and does not replace the displayed review until a new match is found.

All searches discover up to **100 popular public repositories**, including when no language or topic is selected. Repositories must be public, non-fork, non-archived, and have at least **1,000 stars**. Software projects are preferred over tutorial and link collections. Repository language narrows discovery; changed-file extensions enforce the final language filter. Large language/topic selections that exceed GitHub's query length limit use broader discovery and still validate every changed file and all selected topics.

The viewer uses GitHub-style unified diffs: filenames, hunk headers, old/new line numbers, context, and green/red additions/deletions. It shows the PR title, repository topics, default branch, and a link to its original changed files. A PR only qualifies if a human reviewer other than the PR author left a nonempty root inline review comment on one of the changed files (including a file's previous name). Empty approvals, author-only comments, bot-only reviews, and ordinary issue discussion do not qualify. Earlier-revision comments can qualify and are explicitly labeled in comparison.

### Write and compare your review

- In **Your review**, hover over a diff line and click its blue **+**, or reach it with the keyboard. Comment on an old or new line using Markdown; **Preview** shows how it will render.
- On a new line, choose **Suggest a change** and enter replacement code. A suggestion replaces one line with one or more lines; an empty replacement proposes deleting the line. Suggestions appear as a red/green change preview. Deleted lines support comments.
- **Add comment locally** saves the comment in page memory. Saved comments can be edited or deleted. An optional overall review summary is available below the diff. Finish or cancel an open comment before starting another or comparing.
- Select **Compare reviews** or **Ready to compare reviews** to reveal your review alongside the original GitHub comments, replies, suggestions, and written review summaries, grouped by file. Earlier-revision comments include expandable original code context. More comment/summary pages can be loaded on demand.

Practice reviews are **local to the current page**: fetching another PR or refreshing clears them. They are never posted to GitHub, and the app has no write API operations. Original comment bodies stay out of the practice view until you choose comparison. PR descriptions are not displayed.

Documentation-only changes, non-source files, binary files, missing patches, and incomplete patches are skipped. The entire PR must meet the limits; the app does not cut down larger PRs. Renamed, added, and deleted source files are supported. Language options and size limits are in `src/lib/preferences.ts`; discovery and filtering are in `src/lib/github.ts`.

The browser calls GitHub's REST API directly; a personal token is optional. Tag suggestions load automatically after language changes with a short debounce and a 15-second timeout. Repository metadata, candidate queues, and validated review pools are cached in memory for the current page session, separately for each filter combination. Repository order and PR candidates are shuffled, with candidates mentioned in recent human inline review discussions checked first. A refill searches up to three repositories, checks up to 12 candidates, and collects up to three fully matching reviewed PRs before choosing randomly. When possible, it picks a different repository from the last example. Subsequent clicks consume the validated pool without API requests; exhausted pools advance to other repositories and later PR pages. Previously shown reviews are not repeated within that connection, even after changing filters.

Searches time out after 45 seconds. Narrow preferences may need several batches; click again to continue or widen the ranges. Qualification checks at most three pages of inline comments per candidate, stopping when reviewer feedback is confirmed. Remaining pages can be loaded in comparison, where written review summaries are fetched on demand with a 15-second timeout. Network and rate-limit failures keep the previous practice visible; validated pool entries remain available for retry. No fixtures or invented reviews are used as a fallback.

New language/tag combinations can require repository discovery, PR search, and several file requests. The app observes rate-limit reset times and retry delays, and avoids sending another request during the applicable cooldown.

## Connect your GitHub token

1. Create a [fine-grained personal access token on GitHub](https://github.com/settings/personal-access-tokens/new), with a name such as `Just-A-Nit` and an expiration date. Its default read-only public repository access is sufficient for this app; no additional account permissions, private repository access, or write permissions are needed. See [GitHub's token guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
2. In the app's **GitHub access** panel, paste the token into the masked **Personal access token** field and click **Use token**.
3. The app verifies authentication through GitHub's `/rate_limit` endpoint before switching connections. **Token connected** and the remaining REST/search quotas appear once verification succeeds. Topic discovery, repository search, PR search, changed files, inline review comments, and review summaries all use the token. These review reads use GitHub's documented [review comments](https://docs.github.com/en/rest/pulls/comments#list-review-comments-on-a-pull-request) and [review summaries](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request) endpoints.

The token is held only in the current page's memory and sent as a Bearer authorization header directly to `https://api.github.com`. It is not written to localStorage, sessionStorage, cookies, source files, or the Docker image. The input is cleared after successful connection. Refreshing the page or clicking **Remove token** clears the active token and returns to anonymous access. There is no server-side credential storage in this personal-use implementation.

An invalid replacement token leaves the existing connection active. Invalid, expired, or revoked tokens report an authentication error; requests do not silently fall back to anonymous access. Changing or removing a token recreates the API connection and its caches while preserving the displayed review and your saved review preferences.

[Personal-token authentication normally provides 5,000 REST requests per hour](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), shared with other requests using your account. Anonymous access provides 60 per hour per public IP. [Repository and PR search have a separate limit](https://docs.github.com/en/rest/search/search): 30 requests per minute with authentication, or 10 without. Secondary limits can still apply. The panel displays GitHub's reported quota and updates it after topic or review requests.

For a future multi-user deployment, replace this personal-token entry flow with a backend and GitHub OAuth or a GitHub App, plus shared caching. Avoid embedding a personal token in frontend code or `VITE_*` build variables.

## Start development

Run these commands from the project directory in a Linux terminal:

```sh
docker compose up --build -d web
```

Open **http://localhost:5173**. Edit files under `src/` in your editor; Vite refreshes the page when you save. The source directory is mounted into the container, while dependencies live in a separate Docker volume. Polling is enabled to support Docker Desktop file sharing too.

```sh
# View server output
docker compose logs -f web

# Open a shell inside the development container
docker compose exec web sh

# Stop the application
docker compose down
```

Servers bind to the local machine only. Change the port mappings deliberately if you want access from another computer.

## Check and compile

With the development container running:

```sh
# ESLint, automated tests, TypeScript checking, and a production compilation
docker compose exec web npm run check

# Compile only; output is written to dist/ in the project directory
docker compose exec web npm run build
```

No host Node.js installation is needed. Individual commands also work without starting the server:

```sh
docker compose run --build --rm --no-deps web npm run check
```

The development process runs as the image's `node` user (UID 1000). On Linux, generated files belong to that UID. If your host UID differs, use the optional VS Code dev container below, which adjusts the development user's UID to match yours.

## Build and run the production image

```sh
docker build --target production -t mr-practice-app .
docker run --rm -p 127.0.0.1:8080:8080 mr-practice-app
```

Open **http://localhost:8080**. The build runs linting, automated tests, and TypeScript checks, compiles the app, then copies only the static output into an Nginx image. The server runs without root privileges and includes an HTTP health check and SPA route fallback. It does not use Vite's development server.

Alternatively, use Compose:

```sh
docker compose --profile production up --build -d production
docker compose --profile production down
```

For internet deployment, configure HTTPS and hosting for your environment. This starter provides a runnable image, not a hosting configuration.

## Manage dependencies inside Docker

```sh
docker compose exec web npm install package-name
docker compose exec web npm install --save-dev package-name
```

These update `package.json` and `package-lock.json` on the host. Commit both files. Fresh image builds use `npm ci` and the lockfile for reproducible installs.

After switching branches or pulling dependency changes, refresh the existing dependency volume:

```sh
docker compose stop web
docker compose run --build --rm --no-deps web npm ci
docker compose up -d web
```

For a clean dependency reset, `docker compose down --volumes` removes this project's dependency volume; the next startup recreates it. This starter stores no application data in that volume.

## Optional: develop with VS Code inside the container

Install VS Code's **Dev Containers** extension, open this folder, and run **Dev Containers: Reopen in Container**. The included configuration uses the same Compose development service. The terminal, TypeScript language tools, and ESLint extension then run inside the container too.

## Project layout

```text
src/App.tsx           Review loading and page states
src/components/      GitHub-style diff viewer
src/lib/             GitHub search and unified patch parsing
tests/               Parser, selection, and API behavior tests
src/main.tsx          React entry point
src/styles.css        Responsive page styles
vite.config.ts        Development server and bundler configuration
Dockerfile            Development, build, and production stages
compose.yaml          Development mounts and optional production service
nginx.conf            Production static server
.devcontainer/        Optional container-based editor setup
.github/workflows/    Container build validation on pushes and pull requests
```

TypeScript strict mode and ESLint catch common mistakes. `.editorconfig` and `.gitattributes` keep formatting and Linux line endings consistent. Secrets, local configuration, dependencies, and build output are excluded from Git or the Docker build context. Any `VITE_*` variable is public browser configuration: never put secrets in it.

Run `docker compose exec web npm test` for the automated tests. They use mocked GitHub responses, so tests and production builds do not depend on GitHub availability or API quota.
