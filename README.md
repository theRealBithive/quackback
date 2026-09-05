<p align="center">
  <a href="https://quackback.io">
    <img src=".github/logo.svg" alt="Quackback Logo" width="80" height="80" />
  </a>
</p>

<h1 align="center">Quackback</h1>

<p align="center">
  <strong>Open source support and product feedback for teams that ship.</strong>
</p>

<p align="center">
  The open-source alternative to Canny, UserVoice, and Productboard.<br />
  Collect feedback. Answer customers. Prioritize what matters. Close the loop.
</p>

<p align="center">
  <a href="https://quackback.io">Website</a> &middot;
  <a href="https://quackback.io/docs">Docs</a> &middot;
  <a href="#get-started">Get Started</a>
</p>

<p align="center">
  <a href="https://github.com/theRealBithive/quackback/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/theRealBithive/quackback/ci.yml?branch=main&label=CI" alt="CI" /></a>
  <a href="CLAUDE.md#measuring-coverage"><img src="https://img.shields.io/badge/diff%20coverage-enforced%20per%20PR-blue" alt="Diff coverage enforced per pull request" /></a>
  <a href="CLAUDE.md#what-done-means"><img src="https://img.shields.io/badge/mutation%20gate-no%20unjustified%20survivors-blue" alt="Mutation gate: no unjustified survivors" /></a>
  <a href="https://github.com/QuackbackIO/quackback"><img src="https://img.shields.io/badge/fork%20of-QuackbackIO%2Fquackback-lightgrey" alt="Fork of QuackbackIO/quackback" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" /></a>
</p>

> **The two blue badges state a rule, not a measurement.** There is no
> repository-wide coverage or mutation percentage here, deliberately: the gates
> grade **what a change touches**, not the total, because a total is a number
> nobody has to defend and it improves when you measure less. `diff-coverage`
> and `mutation` are jobs in the workflow the CI badge reports, and per PR is
> where they bite: on `main` the comparison base is `main`, so the diff is empty
> and there is nothing for them to grade. What the two rules actually require is
> in [CLAUDE.md](CLAUDE.md).

## This is a fork

Upstream is [QuackbackIO/quackback](https://github.com/QuackbackIO/quackback);
everything below this section is upstream's own description of the product and
is left as it stands, so a sync stays a sync. This section is the fork-local
part.

Exkulpa runs this codebase as a network service for its own products. Under
AGPL-3.0 §13 that carries obligations towards the people using that instance —
what they are, what is already satisfied, and what is still open is recorded in
[LEGAL.md](LEGAL.md). Read it before building anything proprietary in here.

Four things differ from upstream and will bite whoever ignores them:

- **Everything written into the repo is English** — code, comments, commits,
  docs. The conversation around it is German; the file is not. A patch has to be
  able to go upstream without a translation pass.
- **The contract comes before the tests, and the tests before the code.** For
  anything with branches, money, dates, permissions or parsing, the guarantees
  are written as a numbered list in plain domain language and confirmed _before_
  a property is written. A property read off the implementation cannot fail.
- **Two CI gates grade the diff, not the repo** — see the badges above.
- **Never deploy a moving tag.** A push to `main` publishes
  `ghcr.io/therealbithive/quackback:main`, which is fine to try things with and
  wrong to run: a pod rescheduled overnight silently picks up a different build,
  and afterwards nobody can say which source was running. Every merge gets a
  `vX.Y.Z-exkulpa.N` tag instead.

The working rules are in [CLAUDE.md](CLAUDE.md), and the concrete gotchas that
have already cost someone an afternoon are collected in
[SELF-IMPROVE.md](SELF-IMPROVE.md). Both are fork-local and absent upstream, so
neither ever conflicts on a sync.

<p align="center">
  <img src=".github/screenshot.png" alt="Quackback feedback portal" width="800" />
</p>

## Get Started

**Cloud** — start free at [app.quackback.io](https://app.quackback.io/signup). We host, scale, and maintain it for you. No setup required.

**Self-hosted** anywhere with [Docker](#docker) or [one click on Railway](#one-click-deploy).

## Why Quackback?

Most support-and-feedback suites are expensive, closed-source, and lock you in. Quackback is the suite you actually own: feedback, shared inbox, help center, changelog, status, and AI.

- **Self-host for free.** Run on your own infrastructure. No per-seat pricing.
- **Own your data.** Feedback, conversations, and knowledge live in your own database. No vendor lock-in.
- **AI-powered.** Automatic duplicate detection, AI summaries, feedback extraction from external sources, and an [MCP server](https://quackback.io/docs/mcp) that lets AI agents search, triage, and act on feedback directly.
- **25 integrations.** Slack, Linear, Jira, GitHub, Intercom, Zendesk, and [more](#integrations) out of the box.

## Features

- **Feedback boards.** Let users vote, comment, and track status on feature requests. Vote on behalf of customers, surface high-revenue accounts in triage, and see a full activity timeline on every post.
- **Quinn AI.** A customer-facing agent and a teammate Copilot. Detect duplicates, summarize themes, connect remote MCP servers as Connectors, and permission every write tool: always allow, ask for approval, or deny.
- **Embeddable widget.** Collect feedback right inside your app with a [drop-in widget](https://quackback.io/docs/widget/installation). Works on desktop and mobile, with native SDKs for [iOS](https://github.com/QuackbackIO/quackback-ios) and [Android](https://github.com/QuackbackIO/quackback-android).
- **Admin inbox.** Triage incoming feedback in one place. Filter, group, dismiss, and restore deleted posts.
- **Roadmap & changelog.** Show users what's planned, in progress, and shipped. Publish updates and schedule posts for later.
- **Integrations.** [25 integrations](#integrations) including Slack, Linear, Jira, GitHub, Intercom, Zendesk, and two-way issue tracker sync.
- **API, webhooks & MCP.** Automate workflows with the REST API, outbound webhooks, and an [MCP server](https://quackback.io/docs/mcp) for AI agents.
- **Internationalization.** Portal and widget available in English, French, German, Spanish, and Arabic with full RTL support. Auto-detects browser language.
- **Flexible auth.** Password, email OTP, Google, GitHub, and SSO with providers like Okta and Auth0.
- **SEO-ready.** Auto-generated sitemap and social sharing previews on every portal page.

## Integrations

Slack, Linear, Jira, GitHub, GitLab, Asana, ClickUp, Monday, Trello, Notion, Shortcut, Azure DevOps, Intercom, Zendesk, Freshdesk, HubSpot, Salesforce, Stripe, Discord, Teams, Segment, Zapier, Make, and n8n.

## Self-Hosted

### One-Click Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/quackback?referralCode=ez8Slg&utm_source=github&utm_medium=readme&utm_campaign=deploy-button)

### Docker

```bash
git clone https://github.com/theRealBithive/quackback.git
cd quackback
cp .env.example .env   # Edit with your configuration
docker build -t quackback -f apps/web/Dockerfile .
docker run -p 3000:3000 --env-file .env quackback
```

Requires PostgreSQL. Set all variables in the canonical [runtime configuration table](docs/configuration.md). Migrations run automatically on startup.

### About the cloud code in this repo

Quackback's hosted service runs this same codebase, and the client side of that arrangement lives here: a default-off `cloud` settings block, plan and entitlement gating, and a control-plane client. On a self-hosted install none of it activates — an install with no cloud configuration is entitled to every feature, no upgrade prompts render, and no outbound requests are made. Disabling is the default; there is nothing to opt out of. This is stated here so you never have to discover it in the code first.

## Contributing

See the [Contributing Guide](CONTRIBUTING.md) to get started.

- [GitHub Discussions](https://github.com/QuackbackIO/quackback/discussions) — ask questions, share ideas

### Local Development

Prerequisites: [Bun](https://bun.sh/) v1.4.0+ and [Docker](https://docker.com/)

```bash
git clone https://github.com/theRealBithive/quackback.git
cd quackback
bun run setup    # Install deps, start Docker, run migrations
bun run db:seed  # Optional: seed demo data
bun run dev      # http://localhost:3000
```

Log in with `demo@example.com` / `password`.

### Tech Stack

- [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) · Full-stack React framework
- [PostgreSQL](https://www.postgresql.org/) + [Drizzle ORM](https://orm.drizzle.team/) · Database, type-safe ORM, and background job queue
- [Better Auth](https://www.better-auth.com/) · Authentication
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) · Styling
- [Bun](https://bun.sh/) · Runtime and package manager

<a href="https://github.com/QuackbackIO/quackback/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=QuackbackIO/quackback" alt="Contributors" />
</a>

## License

[AGPL-3.0](LICENSE).

- **Self-hosting** — free and fully functional, no limits
- **Modifications** — if you distribute or run a modified version as a service, open-source your changes under AGPL-3.0

Contributions require signing our [CLA](CLA.md).
