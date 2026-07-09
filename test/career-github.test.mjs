import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveIdentity } from '../career-identity.mjs'
import { importGithub } from '../career-import-github.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const reviews = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures/github/reviews.json'), 'utf8'))
const prs = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures/github/prs.json'), 'utf8'))
const resolved = resolveIdentity({ githubHandle: 'LinuxDevil' })

test('imports review footprint and PR lifecycle from real fixtures', () => {
  const r = importGithub({ ghJson: { reviews, prs }, resolved })
  assert.ok(!r.error)
  assert.ok(r.reviewFootprint.prsReviewed > 0)
  // reviewedForOthers must never credit my own handle
  assert.ok(!(r.reviewFootprint.reviewedForOthers instanceof Map ? r.reviewFootprint.reviewedForOthers.has('LinuxDevil') : 'LinuxDevil' in r.reviewFootprint.reviewedForOthers))
  assert.ok(Array.isArray(r.prLifecycle.reviewRoundsPerPr))
  assert.ok(r.prLifecycle.reviewRoundsPerPr.some(n => n > 0))
  assert.ok(Array.isArray(r.prLifecycle.timeToFirstReviewHrs))
  assert.ok(r.reviewFootprint.reviewedForOthers.size > 0 || Object.keys(r.reviewFootprint.reviewedForOthers).length > 0)
})

test('never throws — degrades to {error} on bad input', () => {
  const r = importGithub({ ghJson: { reviews: null, prs: null }, resolved })
  assert.ok(r.error)
  assert.deepEqual(r.prLifecycle.reviewRoundsPerPr, [])
  assert.equal(r.reviewFootprint.prsReviewed, 0)
})
