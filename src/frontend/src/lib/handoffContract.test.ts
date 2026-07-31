/**
 * handoffContract — the Specialist's deep links must LAND.
 *
 * The product's spine is: the Specialist tells you what to do, then sends you
 * into the EAM to do it. That handoff is a string. Nothing in the type system
 * connects `path: '/recurring-work?due=overdue'` in missionEngine to the
 * <Route> that serves it, so renaming or removing a route leaves the mission's
 * Go button pointing at nothing — and it fails silently, because the button
 * still renders and still navigates. The user just lands on a blank router
 * fallback and concludes the advice was noise.
 *
 * This test closes that gap by parsing App.tsx as the source of truth and
 * asserting that every path the code can EMIT resolves to a real route. It runs
 * the actual emitters rather than grepping for literals, so a path built at
 * runtime (`/work-orders?asset=${tag}`) is covered too.
 *
 * Second assertion: a deep link that carries a query param is pointless if the
 * destination ignores it — you arrive unscoped and don't notice. For every
 * emitted param, the destination component's source must actually read it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { permKeyForModule } from '../config/modulePermissions';
import { ROLE_PERMISSION_TEMPLATES } from '../eam/constants/rolePermissions';
import { computeMissions } from './missionEngine';
import { routeForAction, deepLink } from './briefingParse';
import { notificationRoute } from './notificationNav';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const APP = read('App.tsx');

// ── Source of truth: the route table ────────────────────────────────────────

/** Every `path="…"` declared in App.tsx, minus the `*` layout catch-all. */
const ROUTE_PATTERNS = [...APP.matchAll(/<Route\s+path="([^"]+)"/g)]
  .map(m => m[1])
  .filter(p => p !== '*');

/** Route pattern → the component name in its `element={…}`. */
const ROUTE_COMPONENT = new Map<string, string>();
for (const m of APP.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
  // The element may be wrapped in gates: <Gated…><PermissionGate…><Page /></…>.
  // The LAST JSX tag before the closers is the page itself.
  const tags = [...m[2].matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map(t => t[1]);
  const page = tags[tags.length - 1];
  if (page) ROUTE_COMPONENT.set(m[1], page);
}

/** Component name → source file, from the lazyWithReload import map. */
const COMPONENT_FILE = new Map<string, string>();
for (const m of APP.matchAll(/const\s+(\w+)\s*=\s*lazyWithReload\(\s*\(\)\s*=>\s*import\('([^']+)'\)/g)) {
  COMPONENT_FILE.set(m[1], m[2]);
}

/** Resolve a concrete path against the route table. `:param` matches anything. */
function matchRoute(path: string): string | null {
  const clean = path.split('?')[0].split('#')[0];
  const segs = clean.split('/').filter(Boolean);
  for (const pattern of ROUTE_PATTERNS) {
    const psegs = pattern.split('/').filter(Boolean);
    if (psegs.length !== segs.length) continue;
    if (psegs.every((p, i) => p.startsWith(':') || p === segs[i])) return pattern;
  }
  return null;
}

// ── The paths the product can actually emit ─────────────────────────────────
// Run the real emitters. Literals would drift; these cannot.

/** missionEngine: inputs chosen so every candidate branch produces a mission. */
const missionPaths = computeMissions(
  {
    overduePmCount: 3,
    overduePmTags: ['P-101A'],
    topOpenAssets: [{ tag: 'K-601', open: 5 }, { tag: 'V-220', open: 2 }],
    pendingProposals: 4,
  },
  null,
).missions.map(m => m.path).filter((p): p is string => !!p);

/** briefingParse: one probe phrase per keyword branch of routeForAction. */
const ACTION_PHRASES = [
  'review CML thickness against t-min',        // integrity
  'run defect elimination on the top actors',  // defect elimination
  'investigate the root cause of the trip',    // rca
  'clear the overdue PM programmes',           // pm
  'work down the open work order backlog',     // work orders
  'check the warranty position',               // assessment
  'approve the outstanding proposal',          // deliver
];
const actionRoutes = ACTION_PHRASES.map(routeForAction).filter((r): r is NonNullable<typeof r> => !!r);

/** deepLink sharpens those routes with the mission's own asset. */
const ASSETS = [{ tag: 'K-601', id: 'uuid-k601' }];
const deepLinked = actionRoutes.map(r => deepLink(r, ASSETS));

/** notificationNav: every entityType branch. */
const NOTIFICATION_TYPES = [
  'WORK_ORDER', 'WORK_REQUEST', 'SERVICE_REQUEST', 'REQUEST', 'ASSET',
  'PURCHASE_ORDER', 'INVENTORY_ITEM', 'PREVENTIVE_MAINTENANCE', 'READING',
  'PERMIT_TO_WORK',
];
const notificationPaths = NOTIFICATION_TYPES
  .map(t => notificationRoute({ entityType: t, entityId: 'abc-123' }))
  .filter((p): p is string => !!p);

/**
 * SpecialistWorkspacePage's own tables (PROPOSAL_HOMES, INTENTS, the loop
 * steps) are module-private consts, so these come from the source text.
 */
const WORKSPACE = read('pages/specialist/SpecialistWorkspacePage.tsx');
const workspacePaths = [...WORKSPACE.matchAll(/path:\s*'([^']+)'/g)]
  .map(m => m[1])
  .filter(p => p.startsWith('/'));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('route table', () => {
  it('parses out of App.tsx', () => {
    // Guards the regexes above: if App.tsx is restructured so these stop
    // matching, every other test here would vacuously pass.
    expect(ROUTE_PATTERNS.length).toBeGreaterThan(40);
    expect(ROUTE_PATTERNS).toContain('/specialist');
    expect(ROUTE_PATTERNS).toContain('/work-orders');
    expect(COMPONENT_FILE.size).toBeGreaterThan(20);
    expect(ROUTE_COMPONENT.size).toBeGreaterThan(20);
  });
});

describe('every licence-gated route also has a role gate', () => {
  // The defect this prevents: a premium route wrapped in ModuleGate alone. The
  // licence check passes for everyone, so the role matrix never runs — the nav
  // item vanishes for an unpermitted role while the URL stays open, and a
  // per-user override an admin set cannot reach the page it was set for.
  const gatedModuleIds = [...new Set(
    [...APP.matchAll(/<Gated\s+moduleId="([^"]+)"/g)].map(m => m[1]),
  )];

  it('finds the Gated routes', () => {
    expect(gatedModuleIds.length).toBeGreaterThan(3);
  });

  it('maps every gated module to an RBAC permission key', () => {
    const unmapped = gatedModuleIds.filter(id => !permKeyForModule(id as never));
    expect(
      unmapped,
      `these licence modules have no RBAC key, so their routes are licence-only: ${unmapped.join(', ')}. ` +
      `Add them to MODULE_ID_TO_PERM_KEY in config/modulePermissions.ts.`,
    ).toEqual([]);
  });

  it('keeps the Specialist open to every role by default', () => {
    // The product decision: the Specialist is the front door, and a technician
    // reaches it from work management. Withdrawing access is a per-user
    // override, not a role default — so no template may ship with it closed.
    const closed = Object.entries(ROLE_PERMISSION_TEMPLATES)
      .filter(([, perms]) => perms.reliability?.view !== true)
      .map(([role]) => role);
    expect(
      closed,
      `these roles cannot view the Specialist: ${closed.join(', ')}. ` +
      `Gating /specialist on 'reliability' would lock them out of the front door.`,
    ).toEqual([]);
  });
});

describe('every emitted deep link resolves to a route', () => {
  const cases: [string, string[]][] = [
    ['missionEngine', missionPaths],
    ['briefingParse.routeForAction', actionRoutes.map(r => r.path)],
    ['briefingParse.deepLink', deepLinked],
    ['notificationNav', notificationPaths],
    ['SpecialistWorkspacePage', workspacePaths],
  ];

  for (const [source, paths] of cases) {
    it(`${source} (${paths.length} paths)`, () => {
      expect(paths.length).toBeGreaterThan(0);   // an empty list must not pass
      const dead = paths.filter(p => !matchRoute(p));
      expect(dead, `${source} emits paths with no matching <Route>: ${dead.join(', ')}`).toEqual([]);
    });
  }
});

/**
 * Handoffs that are known-broken today, keyed `routePattern?param`.
 *
 * notificationNav documents the convention "Assets / Requests / POs / Inventory
 * / PMs open by ?id= query" — but only Assets implements it. Clicking a PO
 * notification lands you on the PO list, not the PO, and nothing says so.
 *
 * These are recorded rather than fixed because each destination opens a record
 * differently, and that is product work, not test work. The entries are
 * asserted to STILL be broken: fix one and this test fails, telling you to
 * delete its line. A stale allowlist is how known gaps quietly become
 * permanent, so this one cannot go stale.
 */
const KNOWN_GAPS = new Map<string, string>([
  ['/requests?id', 'ServiceRequests reads q/plant/type/sort/action — never id'],
  ['/purchase-orders?id', 'PurchaseOrders reads no query params at all'],
  ['/inventory?id', "Inventory reads only ?action=import from window.location.search"],
  ['/recurring-work?id', 'RecurringWork reads q/due/action — never id'],
]);

describe('every emitted query param is read by its destination', () => {
  // Landing somewhere that ignores your param is the quiet failure: the page
  // renders fine, just unfiltered, and nothing tells the user their context
  // was dropped.
  const withParams = [...missionPaths, ...deepLinked, ...notificationPaths]
    .filter(p => p.includes('?'));

  it('has query-carrying links to check', () => {
    expect(withParams.length).toBeGreaterThan(0);
  });

  for (const path of [...new Set(withParams)]) {
    it(path, () => {
      const pattern = matchRoute(path);
      expect(pattern, `no route matches ${path}`).not.toBeNull();

      const component = ROUTE_COMPONENT.get(pattern!);
      expect(component, `no element parsed for route ${pattern}`).toBeTruthy();

      const file = COMPONENT_FILE.get(component!);
      expect(file, `${component} is not in the lazyWithReload import map`).toBeTruthy();

      const source = read(`${file!.replace(/^\.\//, '')}.tsx`);
      const params = [...new URLSearchParams(path.split('?')[1]).keys()];

      for (const param of params) {
        // Look for the param being pulled OFF the query specifically —
        // `searchParams.get('id')`, `urlParams.get('due')`, and so on. Every
        // consumer in this codebase uses that shape.
        //
        // An earlier version of this check just asked whether the file
        // contained the string `'id'` anywhere. It does not work: `'id'` occurs
        // in dozens of unrelated places, so /recurring-work?id= passed while
        // RecurringWork reads only q, due and action. A test that reports a
        // handoff as wired when it isn't isn't weak, it's actively misleading.
        const readsParam = new RegExp(String.raw`\.get\(\s*['"\`]${param}['"\`]\s*\)`).test(source);
        const gapKey = `${pattern}?${param}`;
        const known = KNOWN_GAPS.get(gapKey);

        if (known) {
          expect(
            readsParam,
            `${gapKey} is listed in KNOWN_GAPS ("${known}") but ${component} now reads ?${param}=. ` +
            `Fixed — delete that line from KNOWN_GAPS.`,
          ).toBe(false);
          continue;
        }

        expect(
          readsParam,
          `${component} (${file}) is the destination of ${path} but never reads ?${param}= ` +
          `(no .get('${param}') in the source). The link lands unscoped — the user arrives ` +
          `with their context silently dropped, on a page that looks perfectly fine.`,
        ).toBe(true);
      }
    });
  }
});
