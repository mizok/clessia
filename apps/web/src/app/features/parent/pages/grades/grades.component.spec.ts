import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentGradesService,
  type ParentScoreListResponse,
  type ParentScoreRecord,
} from '@core/parent-grades.service';
import { GradesComponent } from './grades.component';

const PAGE = {
  label: '成績',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

function record(overrides: Partial<ParentScoreRecord> = {}): ParentScoreRecord {
  return {
    id: 'r1',
    type: 'academy',
    examName: '第一次段考',
    examDate: '2026-09-01',
    subjectName: '數學',
    score: 88,
    totalScore: 100,
    status: 'scored',
    ...overrides,
  };
}

describe('GradesComponent', () => {
  let fixture: ComponentFixture<GradesComponent>;
  let listMock: ReturnType<typeof vi.fn>;
  let activeChildId: ReturnType<typeof signal<string | null>>;
  let childScopeLoad: ReturnType<typeof vi.fn>;

  function createComponent(
    response: ParentScoreListResponse | 'error' = {
      data: [],
      meta: { total: 0, page: 1, pageSize: 200, recentCount: 0 },
    },
  ) {
    activeChildId = signal<string | null>(null);
    childScopeLoad = vi.fn();
    listMock = vi.fn(() =>
      response === 'error' ? throwError(() => new Error('boom')) : of(response),
    );

    TestBed.configureTestingModule({
      imports: [GradesComponent],
      providers: [
        {
          provide: ChildScopeService,
          useValue: {
            activeChildId: activeChildId.asReadonly(),
            children: () => [],
            activeChild: () => null,
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: childScopeLoad,
          },
        },
        { provide: ParentGradesService, useValue: { list: listMock } },
      ],
    });

    fixture = TestBed.createComponent(GradesComponent);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as {
      isFailing: (r: ParentScoreRecord) => boolean;
    };
  }

  it('進頁呼叫 childScope.load()', () => {
    createComponent();
    expect(childScopeLoad).toHaveBeenCalledTimes(1);
  });

  it('沒有 activeChildId 時不打 API', () => {
    createComponent();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('activeChildId 出現後打 API，pageSize 200 一次拉完（照抄 student-score-detail-dialog 的既有 pattern）', () => {
    createComponent();
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(listMock).toHaveBeenCalledWith({ childId: 'child-1', pageSize: 200 });
  });

  it('band anchor 直接用 meta.recentCount', () => {
    createComponent({
      data: [record()],
      meta: { total: 1, page: 1, pageSize: 200, recentCount: 3 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.band-anchor__value')?.textContent?.trim()).toBe(
      '3',
    );
  });

  it('依科目分組顯示', () => {
    createComponent({
      data: [
        record({ id: 'r1', subjectName: '數學' }),
        record({ id: 'r2', subjectName: '英文', examName: '單字測驗' }),
      ],
      meta: { total: 2, page: 1, pageSize: 200, recentCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const titles = fixture.nativeElement.querySelectorAll('.grades__subject-title');
    expect(titles.length).toBe(2);
  });

  it('缺考/補考用 chip 顯示，不顯示分數', () => {
    createComponent({
      data: [record({ status: 'absent', score: null })],
      meta: { total: 1, page: 1, pageSize: 200, recentCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('缺考');
    expect(fixture.nativeElement.querySelector('.grades__record-score')).toBeNull();
  });

  it('及格判斷不傳 passScore，退回總分比例——欄位還沒接上前的既有行為', () => {
    const isFailing = createComponent();
    expect(isFailing.isFailing(record({ score: 59, totalScore: 100 }))).toBe(true);
    expect(isFailing.isFailing(record({ score: 60, totalScore: 100 }))).toBe(false);
  });

  it('科目篩選只顯示選中的科目', () => {
    const comp = createComponent({
      data: [record({ id: 'r1', subjectName: '數學' }), record({ id: 'r2', subjectName: '英文' })],
      meta: { total: 2, page: 1, pageSize: 200, recentCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    (comp as unknown as { onSubjectChange: (s: string | null) => void }).onSubjectChange('數學');
    fixture.detectChanges();

    const titles = fixture.nativeElement.querySelectorAll('.grades__subject-title');
    expect(titles.length).toBe(1);
    expect(titles[0].textContent).toBe('數學');
  });

  it('載入失敗顯示失敗狀態', () => {
    createComponent('error');
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
});
