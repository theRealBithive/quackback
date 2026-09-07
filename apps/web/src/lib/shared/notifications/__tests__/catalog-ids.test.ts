/**
 * The notification catalogue's names, as guarantees rather than as code.
 *
 * `catalog.ts` stays English on purpose, the same way `launch-checklist.ts`
 * and `auth-block-messages.ts` do: it is the source of the `defaultMessage`
 * the settings surfaces pass along. What has to exist beside it is a catalogue
 * entry per name, and nothing in the module itself can say whether one does.
 * The ids for those entries live in `message-ids.ts`, and this suite is what
 * the mutation manifest names as holding that module -- so an id scheme
 * changed there without a catalogue to match turns this red.
 *
 * The confirmed guarantees for this batch, verbatim. S1 to S5 are the sign-in
 * half and live in `lib/shared/__tests__/auth-block-messages.test.ts`.
 *
 * S6 Every notification a person can switch on or off is named and described
 *    in every shipped language, on both the admin and the portal settings
 *    surface. [V7, V16]
 * S7 The catalogue carries no notification name the product cannot show, so a
 *    type removed upstream leaves nothing behind that is paid for in nine
 *    languages and shown to nobody. [V16]
 * S8 The groups the settings page buckets notifications into are named in
 *    every language too. A translated list under an English heading is the
 *    failure this one prevents.
 * S9 Neither module's English wording is deleted. It stays as the sentence a
 *    reader whose language we do not ship still sees, and as the text the
 *    build holds the English catalogue against, so the catalogue cannot drift
 *    from the module unnoticed. [V6]
 *
 * Only `en.json` is read here. `locale-parity.test.ts` already holds the nine
 * catalogues to the same key set, so a key present in English and missing in
 * German is that suite's finding, not this one's.
 */
import { describe, it, expect } from 'vitest'
import enMessages from '@/locales/en.json'
import {
  NOTIFICATION_CATALOG,
  catalogForSurface,
  type NotificationGroup,
} from '@/lib/shared/notifications/catalog'
import {
  NOTIFICATION_GROUP_LABELS,
  notificationGroupId,
  notificationLabelId,
  notificationDescriptionId,
} from '@/lib/shared/notifications/message-ids'

const catalogue = enMessages as Record<string, string>

const NOTIFICATION_KEY = /^notification\./

/** Every id the settings surfaces can build, with the English text beside it.
 *  Built inside a function: a mutant that crashes a fixture during collection
 *  is reported as survived, because the suite never runs. */
function reachableText(): Map<string, string> {
  const texts = new Map<string, string>()
  for (const meta of NOTIFICATION_CATALOG) {
    texts.set(notificationLabelId(meta.type), meta.label)
    if (meta.description) texts.set(notificationDescriptionId(meta.type), meta.description)
    texts.set(notificationGroupId(meta.group), NOTIFICATION_GROUP_LABELS[meta.group])
  }
  return texts
}

describe('notification names in the catalogue (S6, S7, S9)', () => {
  it('names and describes every notification a person can switch (S6)', () => {
    const missing = [...reachableText().keys()].filter((id) => !catalogue[id])

    expect(missing).toEqual([])
  })

  it('reaches both settings surfaces, so the check is not empty (S6)', () => {
    // A row a surface never renders needs no translation, and a surface with
    // no rows would make the assertion above prove nothing.
    expect(catalogForSurface('admin').length).toBeGreaterThan(0)
    expect(catalogForSurface('portal').length).toBeGreaterThan(0)
    expect(NOTIFICATION_CATALOG).toHaveLength(19)
  })

  it('says what the module says, so the catalogue cannot drift (S9)', () => {
    const drifted: string[] = []
    for (const meta of NOTIFICATION_CATALOG) {
      const label = notificationLabelId(meta.type)
      if (catalogue[label] !== undefined && catalogue[label] !== meta.label) {
        drifted.push(`${label}: catalogue "${catalogue[label]}" vs module "${meta.label}"`)
      }
      if (!meta.description) continue
      const description = notificationDescriptionId(meta.type)
      if (catalogue[description] !== undefined && catalogue[description] !== meta.description) {
        drifted.push(
          `${description}: catalogue "${catalogue[description]}" vs module "${meta.description}"`
        )
      }
    }

    for (const [group, english] of Object.entries(NOTIFICATION_GROUP_LABELS)) {
      const id = notificationGroupId(group as keyof typeof NOTIFICATION_GROUP_LABELS)
      if (catalogue[id] !== undefined && catalogue[id] !== english) {
        drifted.push(`${id}: catalogue "${catalogue[id]}" vs module "${english}"`)
      }
    }

    expect(drifted).toEqual([])
  })

  it('carries no notification name the product cannot show (S7)', () => {
    const reachable = reachableText()
    const stale = Object.keys(catalogue).filter(
      (id) => NOTIFICATION_KEY.test(id) && !reachable.has(id)
    )

    expect(stale).toEqual([])
  })
})

describe('the groups the settings page buckets rows into (S8)', () => {
  it('names every group in the catalogue (S8)', () => {
    const groups = new Set(NOTIFICATION_CATALOG.map((meta) => meta.group))
    const missing = [...groups].map(notificationGroupId).filter((id) => !catalogue[id])

    expect(missing).toEqual([])
  })

  it('names each group with the same word the module does (S8)', () => {
    // Unguarded on purpose, and it is the only assertion here that is. The
    // drift check above skips an id the catalogue does not define, so that a
    // missing key is S6's finding rather than reported twice -- which leaves
    // an empty label map invisible to both. This one names the three groups
    // and reads each text out, so there is nowhere for it to be skipped.
    expect(Object.keys(NOTIFICATION_GROUP_LABELS).sort()).toEqual([
      'changelog',
      'feedback',
      'support',
    ])
    for (const [group, english] of Object.entries(NOTIFICATION_GROUP_LABELS)) {
      expect(english).not.toBe('')
      expect(catalogue[notificationGroupId(group as NotificationGroup)]).toBe(english)
    }
  })

  it('buckets rows into more than one group, so S8 is not vacuous (S8)', () => {
    const groups = new Set(NOTIFICATION_CATALOG.map((meta) => meta.group))

    expect(groups.size).toBe(3)
  })
})
