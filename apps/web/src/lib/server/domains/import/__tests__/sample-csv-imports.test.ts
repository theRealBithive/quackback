/**
 * `bun run db:generate-csv` writes the sample file people use to try the CSV
 * import. Since #518 the importer skips a row that names no author, so the
 * generator must never produce one — otherwise the sample import silently
 * loses posts. The generator runs as a process (it reads argv and writes at
 * module scope), so this test spawns it the way an operator would and feeds
 * its output to the importer's own parser and row schema.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import Papa from 'papaparse'
import { csvRowSchema } from '../import-row-resolver'

const generator = path.resolve(
  __dirname,
  '../../../../../../../../packages/db/src/generate-sample-csv.ts'
)

function generateSampleCsv(rowCount: number): string {
  const run = spawnSync('bun', [generator, String(rowCount)], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  expect(run.status, run.stderr).toBe(0)
  return run.stdout
}

describe('the sample CSV the generator ships', () => {
  it('names an author on every row, so the importer skips none of them', () => {
    const csv = generateSampleCsv(40)
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })

    expect(parsed.errors).toEqual([])
    expect(parsed.data).toHaveLength(40)
    for (const row of parsed.data) {
      expect(row.author_name, JSON.stringify(row)).not.toBe('')
      expect(row.author_email, JSON.stringify(row)).toMatch(/^[^@\s]+@[^@\s]+$/)
      expect(csvRowSchema.safeParse(row).success, JSON.stringify(row)).toBe(true)
    }
  })

  it('writes the columns the importer reads, in the documented order', () => {
    const csv = generateSampleCsv(1)
    expect(csv.split('\n')[0]).toBe(
      'title,content,status,tags,board,author_name,author_email,vote_count,created_at'
    )
  })
})
