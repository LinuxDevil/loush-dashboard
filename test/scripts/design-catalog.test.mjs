
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fromPackage } from '../../scripts/refresh-design-catalog.mjs'

function fakePackage(dts, pkgJson = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-pkg-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fake-ds', types: 'index.d.ts', ...pkgJson }))
  fs.writeFileSync(path.join(dir, 'index.d.ts'), dts)
  return dir
}

test('PascalCase exports become components; Props/Type helpers do not', () => {
  const dir = fakePackage(`
    export declare const Button: (p: ButtonProps) => JSX.Element;
    export declare function Banner(p: BannerProps): JSX.Element;
    export declare class Modal {}
    export interface ButtonProps { appearance?: 'primary' | 'secondary' }
    export declare const useTheme: () => Theme;
    export declare const ButtonType: string;
  `)
  const { components } = fromPackage(dir)
  const names = components.map(c => c.name)
  assert.deepEqual(names.sort(), ['Banner', 'Button', 'Modal'])
  assert.ok(!names.includes('useTheme'))
  assert.ok(!names.includes('ButtonType'))
})

test('variants come from the component\'s OWN Props block, not a neighbour\'s', () => {
  const dir = fakePackage(`
    export declare const Button: (p: ButtonProps) => JSX.Element;
    export declare const Chip: (p: ChipProps) => JSX.Element;
    export interface ButtonProps {
      appearance?: 'primary' | 'secondary' | 'ghost';
      onClick?: () => void;
    }
    export interface ChipProps {
      size?: 'sm' | 'lg';
    }
  `)
  const byName = Object.fromEntries(fromPackage(dir).components.map(c => [c.name, c]))
  assert.deepEqual(byName.Button.variants.sort(), ['ghost', 'primary', 'secondary'])
  assert.deepEqual(byName.Chip.variants.sort(), ['lg', 'sm'])
})

test('`export { X as Y }` lists resolve to the exported name', () => {
  const dir = fakePackage(`
    declare const InternalCard: any;
    export { InternalCard as Card, Divider };
  `)
  const names = fromPackage(dir).components.map(c => c.name)
  assert.ok(names.includes('Card'), 'renamed export should use the public name')
  assert.ok(!names.includes('InternalCard'), 'internal name should not leak into the catalog')
  assert.ok(names.includes('Divider'))
})

test('a component with no variants is still catalogued, and the shape matches the picker', () => {
  const dir = fakePackage('export declare const Spinner: () => JSX.Element;')
  const { source, components } = fromPackage(dir)
  assert.match(source, /^package:/)
  assert.deepEqual(components[0], { name: 'Spinner', category: 'Components', fullTitle: 'Components/Spinner', variants: [] })
})

test('an unresolvable package fails loudly rather than writing an empty catalog', () => {
  assert.throws(() => fromPackage('@definitely/not-installed-xyz'), /cannot resolve package/)
})

test('a package that ships no .d.ts says so instead of returning nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-pkg-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-types' }))
  assert.throws(() => fromPackage(dir), /ships no \.d\.ts/)
})
