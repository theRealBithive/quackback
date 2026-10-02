/**
 * The German catalogue addresses the reader formally ("Sie"), everywhere.
 *
 * Upstream switched its German to the informal "Du" (#605, `62d78d5c0`); this
 * fork keeps the formal address, decided by the owner on 2026-10-02. Every
 * later pick can bring informal strings with it, which is why this is a test
 * and not a one-off cleanup.
 *
 *   D1 No entry in de.json addresses the reader with an informal pronoun
 *      (du, dich, dir, dein…, euch, euer…).
 *
 * "ihr" is left out of the word list on purpose: as a word it cannot be told
 * from the formal possessive "Ihr" without reading the sentence.
 *   D2 The entries that were informal when this was decided read formally.
 *
 * D1 can only see pronouns. An informal imperative with no pronoun in it
 * ("Wähle ein Board") is not detectable by a word list without flagging nouns
 * that look the same ("Frage stellen", "Suche löschen"), so the ones that
 * existed are pinned by id in D2, and a new one needs a read-through.
 */
import { describe, it, expect } from 'vitest'
import de from '../de.json'

const catalogue: Record<string, string> = de

/** Informal second-person pronouns and possessives, as whole words. */
const INFORMAL_PRONOUN =
  /(?<![\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner|deines|euch|euer|eure|euren|eurem|eurer|eures)(?![\p{L}])/iu

function informalEntries(): string[] {
  const offenders: string[] = []
  for (const [id, message] of Object.entries(catalogue)) {
    if (INFORMAL_PRONOUN.test(message)) {
      offenders.push(`${id}: ${message}`)
    }
  }
  return offenders
}

describe('German formal address', () => {
  it('(D1) no entry addresses the reader with an informal pronoun', () => {
    expect(informalEntries()).toEqual([])
  })

  it('(D1) the pronoun check recognises the informal forms it exists for', () => {
    const informalSamples = [
      'Kommst du?',
      'Danke für dein Feedback',
      'Wir helfen dir.',
      'Deine Idee',
    ]
    for (const sample of informalSamples) {
      expect(INFORMAL_PRONOUN.test(sample), sample).toBe(true)
    }
    const formalSamples = [
      'Kommen Sie?',
      'Danke für Ihr Feedback',
      'Duplikat',
      'Durchsuchen',
      'Edinburgh',
    ]
    for (const sample of formalSamples) {
      expect(INFORMAL_PRONOUN.test(sample), sample).toBe(false)
    }
  })

  it('(D2) the entries that were informal read formally', () => {
    expect(catalogue['widget.launcher.action.messages.sub']).toBe('Mit unserem Team chatten')
    expect(catalogue['widget.launcher.action.messages.sub.assistant']).toBe(
      '{name} und das Team helfen Ihnen'
    )
    expect(catalogue['helpAskAi.noAnswer']).toBe(
      'Wir konnten in unseren Hilfeartikeln keine Antwort finden. Versuchen Sie andere Suchbegriffe oder stöbern Sie in den Artikeln.'
    )
    expect(catalogue['helpAskAi.searchPlaceholder']).toBe(
      'Fragen Sie die KI oder durchsuchen Sie unsere Hilfeartikel, um eine Antwort zu finden'
    )
    expect(catalogue['helpAskAi.rowSubtitle']).toBe(
      'Lassen Sie sich Ihre Frage in Sekunden von der KI beantworten'
    )
    expect(catalogue['widget.success.title']).toBe('Danke für Ihr Feedback!')
    expect(catalogue['widget.success.subtitle']).toBe('Ihre Idee wurde eingereicht.')
    expect(catalogue['widget.home.posting.chooseBoard']).toBe('Wählen Sie ein Board zum Posten')
    expect(catalogue['widget.tickets.stageChanged']).toBe(
      'Status hat sich seit Ihrem letzten Besuch geändert'
    )
    expect(catalogue['widget.help.article.stillStuck']).toBe('Kommen Sie nicht weiter?')
  })
})
