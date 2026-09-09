/**
 * The sign-in outcomes, as guarantees rather than as code.
 *
 * `auth-block-messages.ts` stays English on purpose, the same way
 * `launch-checklist.ts` does: it is the source of the `defaultMessage` every
 * surface passes along, so a reader whose language we do not ship still sees a
 * sentence. What has to exist beside it is a catalogue entry per outcome, and
 * nothing in the module itself can say whether one does.
 *
 * The confirmed guarantees for this batch, verbatim. S6 to S8 are the
 * notification half and live in `notifications/__tests__/catalog-ids.test.ts`.
 *
 * S1 Every sign-in outcome the product can land a person on has a message in
 *    every shipped language. The set is closed and known, so an outcome added
 *    on the producing side with no message fails the build rather than showing
 *    a generic sentence at runtime. [V7, V16]
 * S2 Two sign-in outcomes that read alike today are still two outcomes. Each
 *    keeps its own entry, so rewording one can never silently reword the
 *    other. The duplication is deliberate and paid for in nine languages.
 * S3 The wire carries the outcome, not the sentence. What crosses from server
 *    to browser is the code; the sentence is chosen where it is shown, in the
 *    language of the person reading it. A surface that displays a
 *    server-supplied sentence is a surface that cannot be translated.
 *    [V1, V2]
 * S4 A sign-in outcome the product does not know still produces a sentence in
 *    the reader's language -- never a blank, a bare code, or an English
 *    fallback inside a translated screen. [V6]
 * S5 Two different outcomes never collapse onto one catalogue entry. An
 *    outcome whose name cannot be spelled as a message id is still translated,
 *    and the rule that spells it is one-to-one.
 * S9 Neither module's English wording is deleted. It stays as the sentence a
 *    reader whose language we do not ship still sees, and as the text the
 *    build holds the English catalogue against, so the catalogue cannot drift
 *    from the module unnoticed. [V6]
 *
 * S10 was added after the list was confirmed, and is S7 applied to this
 * module: the catalogue carries no sign-in message the product cannot show.
 * It is here because nothing else can see that hole -- the ids are built at
 * runtime, so the gate's rule for unreferenced keys reads the whole namespace
 * as reached, and a code upstream removes leaves an entry paid for in nine
 * languages and shown to nobody.
 *
 * S3 and S4 are about what a surface renders and are held by the render tests
 * beside those surfaces; the numbers are named there. Only `en.json` is read
 * here -- `locale-parity.test.ts` holds the nine catalogues to one key set.
 */
import { describe, it, expect } from 'vitest'
import enMessages from '@/locales/en.json'
import {
  AUTH_BLOCK_MESSAGES,
  authBlockMessageId,
  type AuthBlockCode,
} from '@/lib/shared/auth-block-messages'

const catalogue = enMessages as Record<string, string>

/** Every sign-in outcome, as code and English text. Built inside a function:
 *  a mutant that crashes a fixture during collection is reported as survived,
 *  because the suite never runs and so nothing fails. */
function outcomes(): [AuthBlockCode, string][] {
  return Object.entries(AUTH_BLOCK_MESSAGES) as [AuthBlockCode, string][]
}

const AUTH_BLOCK_KEY = /^auth\.blocked\./

describe('sign-in messages in the catalogue (S1, S9, S10)', () => {
  it('defines a message for every outcome the product can land on (S1)', () => {
    const missing = outcomes()
      .map(([code]) => authBlockMessageId(code))
      .filter((id) => !catalogue[id])

    expect(missing).toEqual([])
  })

  it('has the outcomes it claims to, so the check is not empty (S1)', () => {
    // Without this the assertion above would pass against an empty map.
    expect(outcomes()).toHaveLength(32)
  })

  it('says what the module says, so the catalogue cannot drift (S9)', () => {
    const drifted = outcomes()
      .map(([code, english]) => ({ id: authBlockMessageId(code), english }))
      .filter(({ id, english }) => catalogue[id] !== undefined && catalogue[id] !== english)
      .map(({ id, english }) => `${id}: catalogue "${catalogue[id]}" vs module "${english}"`)

    expect(drifted).toEqual([])
  })

  it('carries no sign-in message the product cannot show (S10)', () => {
    // The sentence for a code the product does not know is not in this
    // namespace: each surface says its own thing there, in its own namespace,
    // because the popup can say something the toast cannot (S4).
    const reachable = new Set(outcomes().map(([code]) => authBlockMessageId(code)))
    const stale = Object.keys(catalogue).filter(
      (id) => AUTH_BLOCK_KEY.test(id) && !reachable.has(id)
    )

    expect(stale).toEqual([])
  })
})

describe('what an outcome gets its own entry for (S2, S5)', () => {
  it('gives every outcome an entry of its own, alike or not (S2)', () => {
    // Four groups of outcomes read the same today. They are separate events
    // that happen to share copy, so each keeps its own id: rewording one must
    // not silently reword the others.
    const ids = outcomes().map(([code]) => authBlockMessageId(code))

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('shares wording across outcomes today, so S2 is not vacuous (S2)', () => {
    // If upstream ever gives every outcome distinct copy, the assertion above
    // stops being a statement about anything and this one says so.
    const texts = outcomes().map(([, english]) => english)

    expect(new Set(texts).size).toBeLessThan(texts.length)
  })

  it('spells every outcome as an id a message catalogue can carry (S5)', () => {
    // The gate matches ids as [A-Za-z0-9_.:-]; an id outside that matches no
    // pattern and reads as unreachable. Better-Auth spells one code with an
    // apostrophe, so this is a live case, not a precaution.
    const unspellable = outcomes()
      .map(([code]) => authBlockMessageId(code))
      .filter((id) => !/^[A-Za-z0-9_.:-]+$/.test(id))

    expect(unspellable).toEqual([])
  })

  it('has an outcome that cannot be spelled outright, so S5 is not vacuous (S5)', () => {
    const needsSpelling = outcomes().filter(([code]) => !/^[A-Za-z0-9_.:-]+$/.test(code))

    expect(needsSpelling.length).toBeGreaterThan(0)
  })
})
