import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DETECTORS, CONFIDENCE_RANK, detectTestCommand, detectAll } from '../../lib/testdetect.mjs'

// Same temp-tree fixture pattern as flat-kind-walk.test.mjs: never write fixtures into the repo,
// always clean up in `finally`. Keys are relative paths; a key ending in `/` makes a directory.
const withTree = (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testdetect-'))
  try {
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(root, rel)
      if (rel.endsWith('/')) { fs.mkdirSync(p, { recursive: true }); continue }
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, body)
    }
    return fn(root)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

const pkg = obj => JSON.stringify(obj, null, 2)

test('the detector table covers every ecosystem the feature names', () => {
  const ids = DETECTORS.map(d => d.id).sort()
  assert.deepEqual(ids, [
    'bundler', 'cargo', 'composer', 'ctest', 'dotnet', 'flutter', 'go',
    'gradle', 'make', 'maven', 'npm', 'python', 'swift',
  ])
  assert.equal(ids.length, 13)
})

test('the table is inspectable data: every entry is renderable', () => {
  for (const d of DETECTORS) {
    assert.equal(typeof d.id, 'string')
    assert.equal(typeof d.label, 'string')
    assert.equal(typeof d.command, 'string', `${d.id} needs a default command`)
    assert.equal(typeof d.priority, 'number')
    assert.ok((d.markers?.length || 0) + (d.patterns?.length || 0) > 0, `${d.id} needs at least one marker`)
  }
  const priorities = DETECTORS.map(d => d.priority)
  assert.equal(new Set(priorities).size, priorities.length, 'priorities must be distinct so ranking is deterministic')
})

test('a directory with no recognised marker is null, never a guess', () => {
  // The design rule this guards: "unknown is a value". Emitting `make test` for an arbitrary
  // directory produces a failing command that the caller reports as a failing test suite.
  withTree({ 'README.md': '# hi', 'src/main.txt': 'x' }, root => {
    assert.equal(detectTestCommand(root), null)
    assert.deepEqual(detectAll(root), [])
  })
})

test('an unreadable directory throws instead of masquerading as "no tests here"', () => {
  const missing = path.join(os.tmpdir(), 'testdetect-does-not-exist-' + Date.now())
  assert.throws(() => detectAll(missing), /cannot read directory/)
  assert.throws(() => detectTestCommand(missing), /ENOENT|cannot read directory/)
})

test('npm prefers the project\'s own scripts.test over the generic invocation', () => {
  withTree({ 'package.json': pkg({ scripts: { test: 'vitest run' } }), 'package-lock.json': '{}' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'npm')
    assert.equal(d.command, 'vitest run')
    assert.equal(d.confidence, 'high')
    const [m] = detectAll(root)
    assert.equal(m.script, 'vitest run')
    assert.equal(m.runner, 'npm test', 'the portable equivalent is kept: `npm test` puts node_modules/.bin on PATH')
  })
})

test('a package.json with no test script says so instead of claiming `npm test` works', () => {
  withTree({ 'package.json': pkg({ name: 'x', dependencies: {} }) }, root => {
    const [m] = detectAll(root)
    assert.equal(m.id, 'npm')
    assert.equal(m.command, null, 'no command is better than one that exits with "Missing script: test"')
    assert.equal(m.confidence, 'low')
    assert.match(m.note, /no scripts\.test/i)
  })
})

test("npm's placeholder test script is not mistaken for a real one", () => {
  withTree({ 'package.json': pkg({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }, root => {
    const [m] = detectAll(root)
    assert.equal(m.command, null)
    assert.equal(m.confidence, 'low')
    assert.match(m.note, /placeholder/i)
  })
})

test('an unparseable package.json falls back to `npm test` and flags the reason', () => {
  withTree({ 'package.json': '{ this is not json' }, root => {
    const [m] = detectAll(root)
    assert.equal(m.command, 'npm test', 'we do not know what it runs — that is different from knowing it fails')
    assert.equal(m.confidence, 'low')
    assert.match(m.note, /not valid JSON/)
  })
})

test('go recurses over the module rather than testing only the root package', () => {
  withTree({ 'go.mod': 'module example.com/x\n\ngo 1.22\n', 'go.sum': '' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'go')
    assert.equal(d.command, 'go test ./...', 'bare `go test` tests only the cwd package and passes vacuously at a repo root')
    assert.equal(d.confidence, 'high', 'go.sum corroborates the module')
    assert.equal(d.marker, path.join(root, 'go.mod'))
  })
})

test('a lockfile lifts a bare marker to high confidence', () => {
  withTree({ 'Cargo.toml': '[package]\nname = "x"\n' }, root => {
    assert.equal(detectTestCommand(root).confidence, 'medium')
  })
  withTree({ 'Cargo.toml': '[package]\nname = "x"\n', 'Cargo.lock': '' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'cargo')
    assert.equal(d.command, 'cargo test')
    assert.equal(d.confidence, 'high')
  })
})

test('build wrappers are preferred over whatever tool is on PATH', () => {
  withTree({ 'pom.xml': '<project/>', 'mvnw': '#!/bin/sh' }, root => {
    assert.equal(detectTestCommand(root).command, './mvnw test')
  })
  withTree({ 'pom.xml': '<project/>' }, root => {
    assert.equal(detectTestCommand(root).command, 'mvn test')
  })
  withTree({ 'build.gradle.kts': '', 'gradlew': '#!/bin/sh' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'gradle')
    assert.equal(d.command, './gradlew test')
  })
})

test('a Makefile with no test target is declined, not guessed at', () => {
  withTree({ 'Makefile': 'all:\n\tcc -o x x.c\n\ntestdata:\n\ttouch f\n' }, root => {
    assert.deepEqual(detectAll(root), [], 'neither `test:` nor `check:` exists — there is nothing to run')
    assert.equal(detectTestCommand(root), null)
  })
})

test('a Makefile test target is matched, and `check` is the accepted synonym', () => {
  withTree({ 'Makefile': '.PHONY: test\ntest:\n\t./run\n' }, root => {
    assert.equal(detectTestCommand(root).command, 'make test')
  })
  withTree({ 'GNUmakefile': 'check:\n\t./run\n' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'make')
    assert.equal(d.command, 'make check')
  })
  withTree({ 'Makefile': 'test := 1\nall:\n\t@true\n' }, root => {
    assert.equal(detectTestCommand(root), null, 'a `test :=` variable is not a target')
  })
})

test('CMake without testing enabled is declined — ctest would report a vacuous pass', () => {
  withTree({ 'CMakeLists.txt': 'project(x)\nadd_executable(x main.c)\n' }, root => {
    assert.equal(detectTestCommand(root), null)
  })
  withTree({ 'CMakeLists.txt': 'project(x)\nenable_testing()\nadd_test(NAME t COMMAND x)\n' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'ctest')
    assert.match(d.command, /^ctest .*--output-on-failure$/)
  })
})

test('a Flutter pubspec picks the Flutter runner; a plain Dart one does not', () => {
  withTree({ 'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n' }, root => {
    assert.equal(detectTestCommand(root).command, 'flutter test', 'dart test cannot run widget tests')
  })
  withTree({ 'pubspec.yaml': 'name: lib\ndependencies:\n  http: ^1.0.0\n' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'flutter')
    assert.equal(d.command, 'dart test')
  })
})

test('ruby layout decides between rspec and rake', () => {
  withTree({ 'Gemfile': 'source "x"', 'Gemfile.lock': '', 'spec/': '' }, root => {
    assert.equal(detectTestCommand(root).command, 'bundle exec rspec')
  })
  withTree({ 'Gemfile': 'source "x"', 'Rakefile': 'task :test' }, root => {
    assert.equal(detectTestCommand(root).command, 'bundle exec rake test')
  })
  withTree({ 'Gemfile': 'source "x"' }, root => {
    const [m] = detectAll(root)
    assert.equal(m.command, null)
    assert.match(m.note, /no Rakefile/)
  })
})

test('python resolves the strongest config present', () => {
  withTree({ 'tox.ini': '[tox]\nenvlist = py312\n', 'setup.py': '' }, root => {
    assert.equal(detectTestCommand(root).command, 'tox')
  })
  withTree({ 'pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'python')
    assert.equal(d.command, 'pytest')
    assert.equal(d.confidence, 'high')
  })
  withTree({ 'setup.py': 'from setuptools import setup' }, root => {
    assert.equal(detectTestCommand(root).confidence, 'medium')
  })
})

test('dotnet matches project files by extension and prefers a solution', () => {
  withTree({ 'App.csproj': '<Project/>' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.id, 'dotnet')
    assert.equal(d.command, 'dotnet test')
    assert.equal(d.confidence, 'medium')
  })
  withTree({ 'App.csproj': '<Project/>', 'Everything.sln': '' }, root => {
    const d = detectTestCommand(root)
    assert.equal(d.marker, path.join(root, 'Everything.sln'), 'the solution names every project, so one run covers them all')
    assert.equal(d.confidence, 'high')
  })
})

test('composer falls back to the shipped phpunit config when no script is declared', () => {
  withTree({ 'composer.json': pkg({ scripts: { test: 'phpunit' } }), 'composer.lock': '' }, root => {
    assert.equal(detectTestCommand(root).command, 'composer test')
  })
  withTree({ 'composer.json': pkg({ name: 'a/b' }), 'phpunit.xml.dist': '<phpunit/>' }, root => {
    assert.equal(detectTestCommand(root).command, 'vendor/bin/phpunit')
  })
  withTree({ 'composer.json': pkg({ name: 'a/b' }) }, root => {
    const [m] = detectAll(root)
    assert.equal(m.command, null)
    assert.match(m.note, /undefined script/)
  })
})

test('swift needs only its manifest, and Package.resolved corroborates it', () => {
  withTree({ 'Package.swift': '// swift-tools-version:5.9' }, root => {
    assert.equal(detectTestCommand(root).command, 'swift test')
  })
  withTree({ 'Package.swift': '// swift-tools-version:5.9', 'Package.resolved': '{}' }, root => {
    assert.equal(detectTestCommand(root).confidence, 'high')
  })
})

test('a polyglot repo reports every ecosystem, not just the winner', () => {
  // The common shape this guards: a JS frontend beside a Go backend. Returning only one of them
  // silently hides half the test suite from whoever asked "how do I test this?".
  withTree({
    'package.json': pkg({ scripts: { test: 'vitest run' } }),
    'go.mod': 'module example.com/x',
    'go.sum': '',
    'Makefile': 'test:\n\t./all\n',
  }, root => {
    const all = detectAll(root)
    assert.deepEqual(all.map(m => m.id).sort(), ['go', 'make', 'npm'])
    assert.ok(all.every(m => m.confidence === 'high'))
    // All three are high confidence, so the tie breaks on priority: Make is the weakest signal
    // about a project's identity and must never outrank a language-specific detector.
    assert.equal(all.at(-1).id, 'make')
    assert.equal(all[0].id, 'go', 'lowest priority number wins at equal confidence')
  })
})

test('confidence outranks priority when ordering matches', () => {
  // A bare package.json (no test script -> low) must not beat a corroborated Go module, even
  // though npm has the stronger priority.
  withTree({ 'package.json': pkg({ name: 'x' }), 'go.mod': 'module x', 'go.sum': '' }, root => {
    const all = detectAll(root)
    assert.equal(all[0].id, 'go')
    assert.equal(all[1].id, 'npm')
    assert.ok(CONFIDENCE_RANK[all[0].confidence] < CONFIDENCE_RANK[all[1].confidence])
    assert.equal(detectTestCommand(root).command, 'go test ./...')
  })
})

test('every match reports the marker path that triggered it', () => {
  withTree({ 'Cargo.toml': '[package]', 'Cargo.lock': '', 'Makefile': 'test:\n\t@true\n' }, root => {
    for (const m of detectAll(root)) {
      assert.equal(m.markerPath, path.join(root, m.marker))
      assert.ok(fs.existsSync(m.markerPath), `${m.id} must point at a file that exists`)
    }
    assert.equal(detectTestCommand(root).marker, path.join(root, 'Cargo.toml'))
  })
})

test('detection is shallow: markers nested in subdirectories do not answer for the root', () => {
  // Deliberate — a monorepo's per-package markers belong to per-package calls, and an unbounded
  // crawl is not what a caller asking about one directory agreed to pay for.
  withTree({ 'packages/api/go.mod': 'module x', 'README.md': '' }, root => {
    assert.equal(detectTestCommand(root), null)
    assert.equal(detectTestCommand(path.join(root, 'packages/api')).id, 'go')
  })
})

test('results are stable regardless of how many detectors match', () => {
  withTree({
    'Cargo.toml': '[package]', 'Cargo.lock': '', 'go.mod': 'module x',
    'pom.xml': '<project/>', 'Package.swift': '//', 'setup.py': '',
  }, root => {
    const once = detectAll(root)
    assert.deepEqual(detectAll(root), once, 'no readdir-order dependence')
    assert.equal(once.length, 5, 'every match is returned — no cap, silent or otherwise')
    assert.equal(once[0].id, 'cargo')
  })
})
