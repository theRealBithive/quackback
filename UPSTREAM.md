# Upstream ledger

Where this fork stands against [quackbackio/quackback](https://github.com/quackbackio/quackback),
commit by commit. Upstream changes come in as selective `git cherry-pick -x` of
whole upstream commits, never as a merge: the `-x` trailer is what makes this
ledger recomputable, and the merge is what would bring in the parts we have
excluded for good. The fork diverges permanently and on purpose.

**Fork point:** `ce3d24547` (upstream #481, 2026-09-03) is the last commit both
histories share. Everything upstream has landed since is listed below.

**Excluded for good** (decided 2026-09-09; the running service has no use for them):
billing and Stripe (#492–#498, #515), workspace dormancy (#500–#503), the Slack
workspace assistant (#499, #513, #516) and what is entangled with it (#512, #521),
the Helm chart (#323).

**Version notes.** better-auth is `1.6.30` here and `1.7.4` upstream since #540;
the 1.7 fixes (#541, #550, #551) only make sense once that bump lands, and #551
matters to us in particular: 1.7 forwards `signOut()` to the first linked OIDC
provider with an `end_session_endpoint`, which Zitadel has. Migration numbers
are offset by one from upstream's #520 on — upstream `0276_post_tags_is_public`
is our `0277` — and skipping upstream `0277_widget_chat_to_messenger` puts
`0278`–`0280` back in step.

## Recompute

```bash
git fetch upstream
for sha in $(git rev-list --no-merges --reverse "$(git merge-base main upstream/main)..upstream/main"); do
  if git log main --format=%b | grep -q "cherry picked from commit $sha"; then status=picked; else status=open; fi
  printf '%-6s %s %s\n' "$status" "$(git rev-parse --short "$sha")" "$(git log -1 --format=%s "$sha")"
done
```

`open` covers both "not yet" and "never"; the table says which. A row whose
status here disagrees with the command is the thing to fix.

## Commits since the fork point

Oldest first. "Fork" is the merge commit or branch that carried the pick, with
the deploy tag where there is one.

| Upstream         | Date       | Subject                                                                                         | Status                                                                                                                                         | Fork                      |
| ---------------- | ---------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `62f6bcb60` #492 | 2026-09-04 | feat(billing): flat-plan names, savings copy, upgrade-not-add-seat                              | skipped, billing                                                                                                                               | —                         |
| `bc0f601e8` #493 | 2026-09-04 | feat(billing): accept business/enterprise as aliases of pro/scale                               | skipped, billing                                                                                                                               | —                         |
| `25b1ce84d` #485 | 2026-09-04 | feat(sso): custom OIDC provider icon + set avatar from userinfo                                 | picked                                                                                                                                         | #27, `v0.13.3-exkulpa.24` |
| `b8dcf27e5` #482 | 2026-09-04 | feat(auth): copy IdP claims into person attributes on sign-in                                   | picked                                                                                                                                         | #27, `v0.13.3-exkulpa.24` |
| `bb8c7326b` #494 | 2026-09-04 | feat(billing): Quinn usage percent, 1-board Free, quota-fit downgrade                           | skipped, billing                                                                                                                               | —                         |
| `70b438ef0` #486 | 2026-09-04 | fix(portal): hide "Sign up" button when there is no explicit sign-up step                       | picked                                                                                                                                         | #27, `v0.13.3-exkulpa.24` |
| `d042fc92c` #495 | 2026-09-04 | feat(billing): treat pro as the entry tier                                                      | skipped, billing                                                                                                                               | —                         |
| `548d54935` #496 | 2026-09-05 | feat(billing): make pro the canonical entry plan id                                             | skipped, billing                                                                                                                               | —                         |
| `d10c312e1` #497 | 2026-09-05 | feat(billing): drain leftover growth/scale from checkout POSTs                                  | skipped, billing                                                                                                                               | —                         |
| `9d222efbf` #498 | 2026-09-05 | feat(billing): drop dead per-seat purchase path                                                 | skipped, billing                                                                                                                               | —                         |
| `8c160b187` #500 | 2026-09-06 | feat(fleet): park job loops and fleet sweeps for workspaces nobody visits                       | skipped, dormancy                                                                                                                              | —                         |
| `79fd1312a` #501 | 2026-09-06 | fix(workspaces): anonymous reads no longer count as workspace activity                          | skipped, dormancy                                                                                                                              | —                         |
| `3f6a0bddd` #502 | 2026-09-06 | docs(workspaces): describe the dormancy rule without deployment specifics                       | skipped, dormancy                                                                                                                              | —                         |
| `06b4c3fb9` #503 | 2026-09-06 | fix(realtime): tear down chat streams inside the request's workspace scope                      | skipped, dormancy                                                                                                                              | —                         |
| `f57343dd1` #506 | 2026-09-06 | perf(jobs): prune terminal rows on their own hourly clock, index-usable bound                   | picked, dormancy block dropped                                                                                                                 | #29, `v0.13.3-exkulpa.26` |
| `9a0e74ef0` #499 | 2026-09-07 | Add Slack workspace assistant and Cloud integration-gateway client                              | skipped, Slack                                                                                                                                 | —                         |
| `e1565ed55` #508 | 2026-09-07 | fix(sso): honor stored profile mappings and stop leaking claim values                           | picked                                                                                                                                         | #28, `v0.13.3-exkulpa.25` |
| `91307e8be` #509 | 2026-09-07 | feat(sso): share claim binder, V2 test capture, and lossless mapping saves                      | picked                                                                                                                                         | #28, `v0.13.3-exkulpa.25` |
| `9dcd6a2fc` #510 | 2026-09-07 | feat(sso): ship the attributes and claims table with draft preview                              | picked                                                                                                                                         | #28, `v0.13.3-exkulpa.25` |
| `f9ba7ab04` #512 | 2026-09-07 | fix(integrations): connect platform-managed apps without pasting credentials                    | skipped, Cloud gateway                                                                                                                         | —                         |
| `adab4bc41` #513 | 2026-09-07 | fix(assistant): tell Slack who asked and resolve assign-to-me                                   | skipped, Slack                                                                                                                                 | —                         |
| `d53fadf7d` #514 | 2026-09-07 | fix(sso): stop the test-sign-in preview from squashing the mapping table                        | picked                                                                                                                                         | #28, `v0.13.3-exkulpa.25` |
| `225108a00` #515 | 2026-09-07 | fix(billing): accept custom-domain Origin on Stripe checkout POSTs                              | skipped, billing                                                                                                                               | —                         |
| `c0a01c341` #516 | 2026-09-07 | fix(assistant): hide workspace knobs; keep Connectors/Skills                                    | skipped, Slack                                                                                                                                 | —                         |
| `de5af8512` #507 | 2026-09-08 | fix(merge): strict item schema so OpenAI Structured Outputs accept the merge assessment request | picked                                                                                                                                         | #29, `v0.13.3-exkulpa.26` |
| `d116df341` #518 | 2026-09-08 | fix(import): honour CSV author_name and require an author                                       | picked                                                                                                                                         | #29, `v0.13.3-exkulpa.26` |
| `e85739f78` #517 | 2026-09-08 | feat(sso): simplify OIDC setup to connect, test, enable                                         | picked                                                                                                                                         | #28, `v0.13.3-exkulpa.25` |
| `c34aef7b5` #520 | 2026-09-09 | feat(tags): per-tag portal visibility ("Show on portal")                                        | picked, migration renumbered to `0277`                                                                                                         | #29, `v0.13.3-exkulpa.26` |
| `afd948620` #521 | 2026-09-09 | feat(jobs): start queued work by id instead of waiting on the poll                              | skipped, entangled with Slack and dormancy                                                                                                     | —                         |
| `7ed622419` #524 | 2026-09-09 | fix(auth): only send new-sign-in mail on a real sign-in                                         | picked                                                                                                                                         | #27, `v0.13.3-exkulpa.24` |
| `4ef5beb92` #527 | 2026-09-09 | feat(tags): restyle the create/edit tag dialog                                                  | picked                                                                                                                                         | #31, `v0.13.3-exkulpa.28` |
| `fb3c1a9f6` #525 | 2026-09-09 | fix(auth): identify new-sign-in devices by browser, not IP                                      | picked                                                                                                                                         | #31, `v0.13.3-exkulpa.28` |
| `7aac54889` #529 | 2026-09-09 | feat(auth): identify new-sign-in devices by a signed cookie                                     | picked                                                                                                                                         | #31, `v0.13.3-exkulpa.28` |
| `ce6951a67`      | 2026-09-09 | fix(db): keep 0.13 upgrades on core products and migrate chat widget settings                   | skipped: only relevant to a database that still holds pre-messenger `chat` widget settings; skipping keeps `0278`–`0280` in step with upstream | —                         |
| `1c8d14473` #532 | 2026-09-09 | fix(editor): let Enter insert a newline in comments                                             | picked                                                                                                                                         | #31, `v0.13.3-exkulpa.28` |
| `43df5c9d3` #531 | 2026-09-10 | fix(widget): honour documented open() deep-links                                                | picked                                                                                                                                         | #31, `v0.13.3-exkulpa.28` |
| `a720add94`      | 2026-09-10 | feat(ids): serialize help-center articles as article_                                           | picked                                                                                                                                         | #31, `v0.13.3-exkulpa.28` |
| `bcd4e6b76` #536 | 2026-09-10 | fix(auth): persist better-auth 2FA lockout columns                                              | picked; a live bug on better-auth 1.6.30 (upstream #432)                                                                                       | #31, `v0.13.3-exkulpa.28` |
| `8c552b675` #537 | 2026-09-10 | fix(fleet): include 0278 in the post-0248 replay-gate span                                      | done by hand: our span lists our own migrations                                                                                                | #31, `v0.13.3-exkulpa.28` |
| `1f795b090` #538 | 2026-09-10 | feat(widget): two-step install with a lazy signing secret                                       | picked                                                                                                                                         | #31, `v0.13.3-exkulpa.28` |
| `19c3bd172` #539 | 2026-09-11 | fix(conversation): keep pasted screenshots in aspect on the attachment tray                     | picked                                                                                                                                         | #31, `v0.13.3-exkulpa.28` |
| `30d9bc805` #540 | 2026-09-11 | feat(mcp): scoped OAuth with write-implies-read (better-auth 1.7.4, migration 0279)             | picked                                                                                                                                         | #32, `v0.13.3-exkulpa.29` |
| `0db59438c` #541 | 2026-09-11 | fix(auth): label social callback failures as oauth, not SSO                                     | picked                                                                                                                                         | #32, `v0.13.3-exkulpa.29` |
| `06e7de186` #542 | 2026-09-11 | fix(e2e): bust caches with IN and retarget post-MCP-move specs                                  | picked                                                                                                                                         | #32, `v0.13.3-exkulpa.29` |
| `8b38983dc` #543 | 2026-09-11 | test(mcp): fail if a resource ships without a 403 mapping                                       | picked                                                                                                                                         | #32, `v0.13.3-exkulpa.29` |
| `98b18e3ee`      | 2026-09-11 | feat(widget): pair the agent install so the signing secret never hits chat                      | picked                                                                                                                                         | #32, `v0.13.3-exkulpa.29` |
| `0935071a6` #545 | 2026-09-11 | feat(ui): migrate overlay primitives from Radix to Base UI                                      | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `ee44b03ba` #545 | 2026-09-11 | fix(inbox): keep composer focus across send                                                     | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `ebe630799` #545 | 2026-09-11 | perf(editor): cut per-keystroke work in post and comment composers                              | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `94dcab894` #545 | 2026-09-11 | fix(pr-545): address Codex review feedback                                                      | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `48045ccc3` #545 | 2026-09-11 | fix(pr-545): resolve follow-up review threads                                                   | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `c926b53f3` #545 | 2026-09-11 | fix(pr-545): resolve second review round                                                        | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `9a92f530e` #545 | 2026-09-11 | fix(billing): give the branding checkbox its own label path                                     | picked (the checkbox primitive, not billing)                                                                                                   | #33, `v0.13.3-exkulpa.30` |
| `4aa245e63` #546 | 2026-09-11 | refactor: simplification batch, dead-code sweep and shared building blocks                      | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `e31eb058b` #546 | 2026-09-11 | refactor: share taxonomy validators, ticket slugs, and attribute fn schemas                     | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `0c9255422` #546 | 2026-09-11 | refactor: share nextPosition, attribute types, and webhook safe-dispatch                        | picked                                                                                                                                         | #33, `v0.13.3-exkulpa.30` |
| `99fb7a1d2` #547 | 2026-09-12 | feat(widget): scope sessions by audience (migration 0280)                                       | planned, batch D                                                                                                                               | —                         |
| `5cd9c0c11` #550 | 2026-09-12 | fix(auth): pre-insert MCP oauth_resource before Better Auth seed                                | picked (needed with 1.7.4)                                                                                                                     | #32, `v0.13.3-exkulpa.29` |
| `74b480a2a` #551 | 2026-09-12 | fix(auth): keep OIDC sign-out local to Quackback                                                | picked (needed with 1.7.4; Zitadel logout)                                                                                                     | #32, `v0.13.3-exkulpa.29` |
| `615e4da2b`      | 2026-09-13 | fix(inbox): skip non-list cache entries when patching posts                                     | planned, batch D; compare with fork #14, which fixed the same bug                                                                              | —                         |
| `344bcaf62` #554 | 2026-09-13 | chore(deps): update all dependencies to latest                                                  | planned, batch E                                                                                                                               | —                         |
| `f8062929a` #553 | 2026-09-14 | perf(inbox): stop blocking navigation on selection, defer heavy chunks                          | planned, batch E                                                                                                                               | —                         |

## Open upstream pull requests we track

- #445 `feat(email): let self-hosters brand transactional emails` — picked from
  its branch into fork #29 (`v0.13.3-exkulpa.26`) before it merged upstream;
  when it merges, the trailer will not match and this row is the record.
- #490 `fix(events): fan-out resolves against an empty sink registry` — ours,
  offered upstream.

## Fork fixes worth offering upstream

Found by the contract tests and the mutation gate run over the picks; each
carries a test that fails without it, or a survivor list that names the line.

- `resolvePrefix` (`packages/ids/src/prefixes.ts`) answered `__proto__` with
  `Object.prototype` and `valueOf` with a function: the alias table is a plain
  object and the lookup had no own-key guard. Fork #31.
- `ConfirmDialog` closed on a confirm action that threw synchronously, because
  the catch did not `preventDefault()` the click Radix uses to dismiss; an
  async rejection already left it open. Fork #31.
- Three inert pieces in the Better Auth 1.7 MCP helpers, found because no
  input could kill their mutants: `isReverseDomainPrivateUseRedirectUri`
  tested protocol and host before a path check that already excluded them,
  `betterAuthMcpResource` returned the resource for loopback hosts one line
  before returning it for everything, and `mcpDcrRegistrationBody` guarded
  `redirectUris && rewritten` where the second is null exactly when the first
  is. Removed here (fork #32); upstream still carries them.
