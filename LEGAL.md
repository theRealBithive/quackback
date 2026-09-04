# Licensing notes for this fork

**These are our own working notes, not legal advice.** They record what we
understood on 2026-09-04 so the reasoning is not lost, and so the open questions
stay visible instead of being rediscovered. Anything marked _open_ needs someone
who is qualified to answer it before we act on it.

## Where we stand

This repository is a fork of [quackbackio/quackback](https://github.com/quackbackio/quackback),
licensed **AGPL-3.0** — a single `LICENSE` at the root, no enterprise directory
under a different licence, `"license": "AGPL-3.0"` in both manifests. We run a
modified build of it as a network service that our customers use.

Two consequences follow from that, and they are not optional:

- **AGPL §13.** Anyone who _uses_ our instance is entitled to be offered the
  Corresponding Source of the version that is actually running — ours, with our
  changes, not upstream's.
- **AGPL §5.** Our changes are themselves AGPL-3.0. We cannot put the fork under
  different terms.

## What we do about it

**The fork is public.** Availability of the source is therefore not the problem.

**We deploy tagged versions, never a moving tag.** This is the part that is easy
to get wrong and that quietly breaks §13: if production runs whatever `:main`
resolved to at 3am, nobody can say afterwards which source corresponds to it.
Every deployed build must come from a git tag, and Kubernetes pins that exact
tag (see the image-tag section in [CLAUDE.md](CLAUDE.md) and the workflow in
`.github/workflows/docker.yml`). Fork builds are named `vX.Y.Z-exkulpa.N`.

**_Open:_ the running app does not offer the source to its users.** Availability
is not the same as an offer — §13 asks that users be given the opportunity to
receive it, which means telling them where it is. The only outbound link on the
public portal today is "Powered by Quackback", which points at the vendor's
marketing site, not at our modified source. A line in the portal footer naming
the running version and linking to the matching tag in this repository would
close it. Small job, not yet done.

## The boundary to our own products

This is the question that actually matters commercially, and the one we should
not answer ourselves.

The AGPL reaches "the work as a whole". Roughly, and subject to advice:

- **Separate programs talking over HTTP or an API** — our DSMS calling the
  Quackback API, or the reverse — are normally treated as independent works. Our
  own product stays our own.
- **Code written into this codebase** — an integration living in this repo, a
  module that gets imported — becomes part of the work, and is then AGPL, with
  the same obligation towards the users of the service.

The line runs somewhere between those two and it is genuinely fuzzy. **Ask
counsel before building anything customer-specific or proprietary into this
repository.** Clarifying it up front is far cheaper than removing an integration
afterwards.

## What the licence does not require

Recording these because they are the assumptions people arrive with:

- We may run this commercially and charge our customers for it. The AGPL does
  not restrict making money.
- We owe upstream **nothing**. Contributing back is a choice, not an obligation.
- Our data, configuration, environment variables and customer content are not
  source code and are nobody else's business.
- The offer runs to the _users of our instance_, not to the general public. Our
  repository being public is our own decision, not a requirement.

## Two things the AGPL does not cover

- **Trademark.** The name and logo "Quackback" are not licensed by the AGPL. If
  we ever offer this under our own branding, that is a separate question.
- **Contributing upstream.** Upstream requires a CLA that lets Quackback use
  contributions under any terms, including their commercial licence. That grant
  runs one way: what we give them, they may relicense; their code stays AGPL for
  us. Worth being deliberate about, not a reason to avoid contributing.

## Open items

- [ ] Add a source offer to the public portal: running version + link to the
      matching tag in this repository.
- [ ] Get advice on the boundary above before any proprietary integration lands
      in this repo.
- [ ] Keep the fork public for as long as the instance is reachable. Making it
      private while the service runs would break §13 immediately.
