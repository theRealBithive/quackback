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
  in einem laufenden Tier immer ein Bug, nie ein gültiger Zustand. *(In diesem Lauf
  nachgezogen — die beiden folgenden Punkte fehlen weiterhin.)*
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
