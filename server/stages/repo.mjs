// Stage 7 — `repo`. The checkout, as the rest of the pipeline sees it: every path in it, and which
// of the project's own skills and commands an agent stage may be told to prefer.
//
// There is nothing to resolve here (spec §6): the selected workspace IS the checkout, so "target
// repo not checked out locally" cannot occur. Only two residual states remain, and they are the
// point of this stage — the dir vanishing between selection and run (refuses the whole run) and the
// workspace not being a git repo (runs degraded).

import fs from 'node:fs'
import path from 'node:path'
import { entry } from '../../lib/dossier.mjs'
import { repoFileList, detectCapabilities, WALK_CAP } from '../ticket.mjs'

const STAGE = 'repo'

// What `tracked: false` actually costs, in the words §2 uses for the git-tracked half. A degraded
// artifact that does not say what is lost reads as durable, which is the failure this flag exists
// to prevent.
const UNTRACKED_REASON = dir =>
  `${dir} is not a git repo, so the dossier is written but not tracked: it is not reviewable in a pull request, does not survive a machine wipe, and does not travel with a clone`
const NO_COMMIT_REASON = 'the workspace is not a git repo, so there is no built_at_commit to compare against HEAD and graphify staleness cannot be computed'

export async function repo({ repoDir, cacheDir }) {
  // Same reason text as `repoFor` (`ticket.mjs:218`). `refusesRun` is what separates this from an
  // ordinary unavailable source: the workspace is where the manifest GOES, so its absence is a
  // precondition of the run existing, not a missing input the run can note and carry on past.
  if (!repoDir || !fs.existsSync(repoDir)) {
    return entry({
      stage: STAGE, status: 'failed',
      reason: `${repoDir} no longer exists on disk`,
      provenance: { refusesRun: 'workspace-vanished' },
    })
  }

  const { files, truncated } = repoFileList(repoDir)
  const caps = detectCapabilities(repoDir)
  const isGit = fs.existsSync(path.join(repoDir, '.git'))

  // The list goes to the disposable half — it is a walk of a checkout that is already on disk, so
  // it is free to redo, and 5000 paths in a git-tracked manifest would be noise in every diff.
  fs.mkdirSync(cacheDir, { recursive: true })
  const out = path.join(cacheDir, 'files.json')
  fs.writeFileSync(out, JSON.stringify({ files, truncated }, null, 2))

  return entry({
    stage: STAGE, status: 'ok',
    reason: isGit ? null : UNTRACKED_REASON(repoDir),
    artifacts: [out],
    tracked: isGit,
    provenance: {
      fileCount: files.length,
      truncated,
      skills: caps.skills.map(s => s.name),
      commands: caps.commands.map(c => c.name),
      // Carried, not just recorded: `decompose`'s file scopes are validated against this list, and
      // against a truncated one "matches nothing in the checkout" may be the cap rather than a bad
      // path. Same shape and words as the existing finding at `ticket.mjs:571-574`.
      warnings: truncated ? [{
        severity: 'warn', kind: 'checkout-truncated',
        detail: `the file walk stopped at ${WALK_CAP} paths, so a "matches nothing in the checkout" finding may be the cap rather than a bad path`,
      }] : [],
      ...(isGit ? {} : { premark: { 'blast-radius': { status: 'unavailable', reason: NO_COMMIT_REASON } } }),
    },
  })
}

export const STAGES = { [STAGE]: repo }
