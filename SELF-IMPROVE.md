# SELF-IMPROVE

Gotchas aus konkreten Arbeitsläufen in diesem Repo. Pro Eintrag ein Zähler; beim
erneuten Auftreten hochzählen und die Liste nach Zähler absteigend sortieren.

## 1x — Der Event-Fan-out kann komplett tot sein, ohne dass irgendetwas es sagt

`resolveTargets` (`events/resolvers/registry.ts`) löst gegen ein Modul-Array auf, das
nur `registerAllResolvers()` befüllt. Verliert der letzte Aufrufer sein Call-Site
(genau das passierte beim WO-18-Cutover, der `getHookTargets()` entkoppelte), liefert
jeder Resolve `[]`: das Event wird als `published` gestempelt, kein Hook-Job entsteht,
kein Log, kein Fehler. Sämtliche Sinks — Integrationen, Webhooks, Notifications, AI,
Workflows — sind dann still aus.

Die Diagnose kostete rund fünfzehn Turns und mehrere DB-Runden über `events`,
`job_queue`, `kv_store` und `hook_deliveries`, weil kein einziger Log-Eintrag in die
richtige Richtung zeigte. Was gefehlt hat:

- Eine Warnung in `resolveTargets`, wenn die Registry leer ist. Ein leeres Register ist
  in einem laufenden Tier immer ein Bug, nie ein gültiger Zustand. _(In diesem Lauf
  nachgezogen — die beiden folgenden Punkte fehlen weiterhin.)_
- Eine Boot-Log-Zeile, die die registrierten Sinks auflistet — analog zu
  `job.worker_started`.
- Ein Admin-Surface für `listResolvers()`. Der Kommentar in `registry.ts:71` nennt es
  bereits "die 'did it fire?'-Fläche", aber nichts exponiert sie.

## 1x — Kein "warum kam nichts an?"-Pfad für Integrationen

Um zu klären, warum eine korrekt konfigurierte GitLab-Integration nichts erzeugt, muss
man die Kette `events` → `job_queue('event-dispatch')` → Resolver → `job_queue('events')`
→ `hook_deliveries` von Hand in SQL nachbauen und dazu wissen, dass der Mapping-Cache in
`kv_store` unter `hooks:integration-mappings` liegt. Zwei Abbruchstellen im Resolver
(`integration.resolver.ts:81-85` fehlende `channelId`, `:91-102` Decrypt-Fehler)
verwerfen ein Target still per `continue`.

Eine Diagnose-Ansicht pro Integration — letztes Event, letztes Target, letzter
Zustellversuch, Grund des Verwerfens — würde diesen Ablauf auf einen Blick reduzieren.
Die Spalten dafür existieren teilweise schon (`last_outbound_at`, `last_error`), werden
aber nur beim tatsächlichen HTTP-Call geschrieben, also genau dann nicht, wenn das
Problem davor liegt.

## 1x — `db:generate` ist kaputt, Migrationen müssen von Hand geschrieben werden

`bun run db:generate` bricht ab mit `[drizzle/meta/0050_snapshot.json, 0051, 0052] are
pointing to a parent snapshot: ... which is a collision.` Die Snapshots enden bei 0052,
die Migrationen laufen bis 0273 — der generierte Pfad wurde vor langer Zeit verlassen.
Tatsächlich üblich ist: SQL-Datei von Hand in `packages/db/drizzle/` anlegen (mit
`IF NOT EXISTS`, wie 0272) und in `drizzle/meta/_journal.json` einen Eintrag anhängen
(`idx` +1, `when` +1, `tag` = Dateiname ohne `.sql`).

Nichts im Repo sagt das. Entweder die Snapshot-Kollision reparieren oder den
`db:generate`-Skripteintrag entfernen und das Handverfahren in `packages/db/README`
festhalten — sonst probiert es jeder neu und verliert dieselbe Runde.

## 1x — Lokaler `typecheck` meldet 815 vorbestehende Fehler

`bun run typecheck` liefert auf einem **sauberen** Tree 815 `error TS`, fast alle in
`apps/web/src/routes/**`, weil die generierten Route-Typen lokal nicht gebaut sind. Ob
die eigene Änderung einen Fehler hinzugefügt hat, lässt sich nur feststellen, indem man
stasht, die Fehler zählt, zurückholt und wieder zählt.

Entweder den Codegen-Schritt in das `typecheck`-Skript ziehen oder dokumentieren, welcher
Befehl vorher laufen muss.

## 1x — Kein dokumentierter Weg zur lokalen Test-Datenbank

Die DB-gestützten Suites brauchen Postgres auf `localhost:5432`, Datenbank
`quackback_test`, migriert. Das steht nirgends zusammenhängend, und der naheliegende
Versuch scheitert: `postgres:16` bricht mitten in der Migration mit
`extension "vector" is not available` ab. Richtig ist `pgvector/pgvector:pg17` (steht nur
in `.github/workflows/ci.yml`), danach
`DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_test bun run db:migrate`.

Verschärfend: fehlt die DB oder ist das Schema veraltet, **überspringt** das Fixture die
Suite lautlos (`describe.skipIf(!fixture.available)`). Der Lauf sieht grün aus und hat
nichts geprüft — in diesem Lauf zeigte er `12 skipped`, was man leicht als Erfolg liest.
Ein `docker compose -f compose.test.yml up -d` plus ein Hinweis in der Ausgabe, wenn eine
Suite mangels DB übersprungen wurde, würde beides erledigen.

## 1x — Keine Property-Test- und Mutation-Infrastruktur

Für nicht-triviale Logik (hier: das Parsen fremder Webhook-Payloads) fehlen die Werkzeuge.
`fast-check` wurde in diesem Lauf als devDependency ergänzt; ein Mutation-Runner
(Stryker) fehlt weiterhin, die Mutanten mussten mit einem Wegwerf-Skript von Hand gesetzt
werden. Solange das so bleibt, ist die Mutation-Zahl in jedem Bericht handgemacht und
nicht reproduzierbar.
