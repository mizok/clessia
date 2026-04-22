import { describe, expect, it } from 'vitest';
import * as schoolsRoute from './schools';

const buildSchoolListQuery = (schoolsRoute as Record<string, unknown>)['buildSchoolListQuery'] as
  | ((params: { search?: string; isActive?: boolean }) => {
      searchFilter: string | null;
      isActiveFilter: boolean | null;
    })
  | undefined;

describe('buildSchoolListQuery', () => {
  it('returns nulls when no filters', () => {
    expect(buildSchoolListQuery?.({})).toEqual({
      searchFilter: null,
      isActiveFilter: null,
    });
  });

  it('builds search ilike with name + short_name', () => {
    expect(buildSchoolListQuery?.({ search: '明湖' })).toEqual({
      searchFilter: 'name.ilike.%明湖%,short_name.ilike.%明湖%',
      isActiveFilter: null,
    });
  });

  it('passes through isActive', () => {
    expect(buildSchoolListQuery?.({ isActive: true })).toEqual({
      searchFilter: null,
      isActiveFilter: true,
    });
  });
});
