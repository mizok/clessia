import { describe, expect, it } from 'vitest';

import {
  formatAuditClassResourceName,
  formatAuditCourseResourceName,
} from './audit';

describe('formatAuditCourseResourceName', () => {
  it('joins course and campus names for course management logs', () => {
    expect(
      formatAuditCourseResourceName({
        courseName: '社會課',
        campusName: '示範分校',
      }),
    ).toBe('社會課 / 示範分校');
  });

  it('falls back to the available course name when campus is missing', () => {
    expect(
      formatAuditCourseResourceName({
        courseName: '社會課',
        campusName: null,
      }),
    ).toBe('社會課');
  });
});

describe('formatAuditClassResourceName', () => {
  it('joins class, course, and campus names for class management logs', () => {
    expect(
      formatAuditClassResourceName({
        className: '班級 A',
        courseName: '社會課',
        campusName: '示範分校',
      }),
    ).toBe('班級 A / 社會課 / 示範分校');
  });

  it('falls back to the available names in order', () => {
    expect(
      formatAuditClassResourceName({
        className: '班級 A',
        courseName: null,
        campusName: null,
      }),
    ).toBe('班級 A');
  });
});
