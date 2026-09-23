import { describe, it, expect } from 'vitest';
import { readOrigin } from './navOrigin';

describe('readOrigin', () => {
    it('reads the { to, label } origin a page was opened with', () => {
        expect(readOrigin({ to: '/admin/migration', label: 'Migration Center' })).toEqual({ to: '/admin/migration', label: 'Migration Center' });
    });
    it('ignores router state that is not an origin', () => {
        expect(readOrigin(null)).toBeNull();
        expect(readOrigin(undefined)).toBeNull();
        expect(readOrigin('x')).toBeNull();
        expect(readOrigin({ assetId: 'abc' })).toBeNull();
        expect(readOrigin({ to: '/admin/migration' })).toBeNull();
        expect(readOrigin({ to: '/admin/migration', label: '  ' })).toBeNull();
    });
    it('refuses a target that is not an in-app path', () => {
        expect(readOrigin({ to: 'https://evil.example', label: 'Home' })).toBeNull();
    });
});
