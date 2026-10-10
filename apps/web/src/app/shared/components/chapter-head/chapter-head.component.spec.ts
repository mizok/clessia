import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChapterHeadComponent } from './chapter-head.component';

describe('ChapterHeadComponent', () => {
  let fixture: ComponentFixture<ChapterHeadComponent>;
  let host: HTMLElement;

  const setup = async (inputs: Record<string, unknown>) => {
    await TestBed.configureTestingModule({ imports: [ChapterHeadComponent] }).compileComponents();
    fixture = TestBed.createComponent(ChapterHeadComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  };

  it('章名與「張數＋單位」都渲染', async () => {
    await setup({ name: '國文', count: 6, unit: '門' });

    expect(host.querySelector('.chapter-head__name')?.textContent?.trim()).toBe('國文');
    expect(host.querySelector('.chapter-head__tally')?.textContent?.replace(/\s+/g, '')).toBe(
      '6門',
    );
  });

  it('count 是 null 就不顯示張數 —— 前端再濾過、API 數字對不上時不編數字', async () => {
    await setup({ name: '國文', count: null, unit: '門' });

    expect(host.querySelector('.chapter-head__tally')).toBeNull();
  });

  it('count 是 0 要顯示（0 是答案，不是缺值）', async () => {
    await setup({ name: '作廢', count: 0, unit: '張' });

    expect(host.querySelector('.chapter-head__tally')?.textContent).toContain('0');
  });

  it('tone=error 章名是紅字，預設是深灰', async () => {
    await setup({ name: '逾期', count: 3, unit: '張', tone: 'error' });
    expect(host.querySelector('.chapter-head__name')?.classList.contains('text-error-700')).toBe(
      true,
    );

    fixture.componentRef.setInput('tone', 'default');
    fixture.detectChanges();
    expect(host.querySelector('.chapter-head__name')?.classList.contains('text-error-700')).toBe(
      false,
    );
    expect(host.querySelector('.chapter-head__name')?.classList.contains('text-zinc-900')).toBe(
      true,
    );
  });
});
