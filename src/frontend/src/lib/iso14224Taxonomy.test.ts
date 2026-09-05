import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CATEGORIES, CLASSES, TYPES, getClass, classesOf, typesOf, isOtherCode,
  failureScopeFor, predictClassFor, taxonomyDictionaryRows, LEGACY_CLASS_MAP,
} from './iso14224Taxonomy';

describe('ISO 14224 taxonomy integrity', () => {
  it('codes are unique within each tier', () => {
    for (const list of [CATEGORIES, CLASSES, TYPES]) {
      const codes = list.map(x => x.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('every class points at a category and every type at a class', () => {
    const cats = new Set(CATEGORIES.map(c => c.code));
    const clss = new Set(CLASSES.map(c => c.code));
    for (const c of CLASSES) expect(cats.has(c.category), c.code).toBe(true);
    for (const t of TYPES) expect(clss.has(t.cls), t.code).toBe(true);
  });

  it('every category and every ISO class has an "Other" child', () => {
    for (const cat of CATEGORIES) {
      expect(classesOf(cat.code).some(c => isOtherCode(c.code)), cat.code).toBe(true);
    }
    for (const cls of CLASSES.filter(c => !isOtherCode(c.code))) {
      expect(typesOf(cls.code).some(t => isOtherCode(t.code)), cls.code).toBe(true);
    }
  });

  it('cascade direction is Category → Class → Type (the live rows had Type → Category)', () => {
    expect(getClass('PUMP')?.category).toBe('ROTATING');
    expect(typesOf('PUMP').map(t => t.code)).toContain('PUMP_CENTRIFUGAL');
    expect(typesOf('PUMP').every(t => t.cls === 'PUMP')).toBe(true);
  });

  it('the failure-scope vocabulary is exactly what 0285/0288 scoped their rows with', () => {
    const scopes = new Set(CLASSES.map(c => c.failureScope).filter(Boolean));
    for (const s of scopes) {
      expect(['ROTATING', 'STATIC_PRESSURE', 'HEAT_TRANSFER', 'PIPING', 'STRUCTURAL', 'ELECTRICAL', 'INSTRUMENT', 'SAFETY_SYSTEM']).toContain(s);
    }
  });

  it('legacy map targets exist', () => {
    for (const [k, v] of Object.entries(LEGACY_CLASS_MAP)) {
      expect(getClass(v.cls), k).toBeDefined();
      if (v.type) expect(TYPES.some(t => t.code === v.type), `${k} → ${v.type}`).toBe(true);
    }
  });
});

describe('failureScopeFor', () => {
  it('resolves ISO classes, legacy codes, and category fallback', () => {
    expect(failureScopeFor({ assetClass: 'HEAT_EXCHANGER' })).toBe('HEAT_TRANSFER');
    expect(failureScopeFor({ assetClass: 'ELECTRIC_MOTOR' })).toBe('ELECTRICAL');
    expect(failureScopeFor({ assetType: 'MOTOR' })).toBe('ELECTRICAL');            // legacy live row
    expect(failureScopeFor({ assetClass: 'CENTRIFUGAL_PUMP' })).toBe('ROTATING');  // legacy live class
    expect(failureScopeFor({ assetType: 'PUMP_CENTRIFUGAL' })).toBe('ROTATING');   // type only
    expect(failureScopeFor({ assetCategory: 'STATIC' })).toBe('STATIC_PRESSURE');
    expect(failureScopeFor({ asset_class: 'CRANE' })).toBe('');                    // general codes only
    expect(failureScopeFor({})).toBe('');
    expect(failureScopeFor(null)).toBe('');
  });
});

describe('predictClassFor', () => {
  it('motors score as electrical even though ISO files them under rotating', () => {
    expect(predictClassFor({ assetClass: 'ELECTRIC_MOTOR' })).toEqual({ cls: 'electrical', note: 'asset_class=ELECTRIC_MOTOR' });
    expect(predictClassFor({ assetClass: 'PUMP' })?.cls).toBe('rotating');
    expect(predictClassFor({ assetClass: 'PRESSURE_VESSEL' })?.cls).toBe('static');
    expect(predictClassFor({ assetCategory: 'INSTRUMENTATION' })?.cls).toBe('instrument');
    expect(predictClassFor({ assetClass: 'CRANE' })).toBeNull();
    expect(predictClassFor({})).toBeNull();
  });
});

describe('migration 0317 carries the same rows', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/0317_iso14224_taxonomy_and_operating_context.sql'), 'utf8');
  it('every category, class and type code is seeded', () => {
    for (const c of CATEGORIES) expect(sql, c.code).toContain(`('ASSET_CATEGORY', '${c.code}'`);
    for (const c of CLASSES) expect(sql, c.code).toContain(`('ASSET_CLASS', '${c.code}'`);
    for (const t of TYPES) expect(sql, t.code).toContain(`('ASSET_TYPE', '${t.code}'`);
  });
  it('dictionary rows expose categoryRef for the pickers', () => {
    const rows = taxonomyDictionaryRows();
    expect(rows.filter(r => r.type === 'ASSET_CLASS').every(r => !!r.categoryRef)).toBe(true);
    expect(rows.filter(r => r.type === 'ASSET_TYPE').every(r => !!r.categoryRef)).toBe(true);
    expect(rows.filter(r => r.type === 'ASSET_CATEGORY').every(r => !r.categoryRef)).toBe(true);
  });
});
