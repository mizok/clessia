import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';

import { CampusesService, type Campus, type Classroom } from '@core/campuses.service';
import { ClassroomsDialogComponent } from './classrooms-dialog.component';

const CAMPUS = { id: 'cp-1', name: '中正分校' } as Campus;
const room = (id: string, name: string, capacity: number | null = 30): Classroom => ({
  id,
  campusId: 'cp-1',
  name,
  capacity,
  equipment: null,
  createdAt: '',
  updatedAt: '',
});

/** #1314 SE3：A6 settings.html#campuses「⋮ › 教室」＋改名／刪除（Q4） */
describe('ClassroomsDialogComponent', () => {
  function setup(rooms: Classroom[] = [room('r1', 'A 教室'), room('r2', 'B 教室', null)]) {
    const service = {
      listClassrooms: vi.fn(() => of({ data: rooms })),
      createClassroom: vi.fn((_c: string, input: unknown) => of({ data: input })),
      updateClassroom: vi.fn((_c: string, _r: string, input: unknown) => of({ data: input })),
      deleteClassroom: vi.fn(() => of({ success: true, affectedSchedules: 2 })),
    };
    const add = vi.fn();
    TestBed.configureTestingModule({
      imports: [ClassroomsDialogComponent],
      providers: [
        { provide: CampusesService, useValue: service },
        { provide: MessageService, useValue: { add } },
      ],
    });
    const fixture = TestBed.createComponent(ClassroomsDialogComponent);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    // jsdom 沒有 showModal／popover；close() 照瀏覽器發 close 事件
    const dialogProto = HTMLDialogElement.prototype as any;
    dialogProto.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    const close = vi.fn();
    fixture.componentInstance.closed.subscribe(close);
    fixture.componentInstance.open(CAMPUS);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const cmp = fixture.componentInstance as any;
    const type = (id: string, value: string) => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const go = () => {
      [...el.querySelectorAll('button')].find((b) => /新增教室|儲存/.test(b.textContent!))!.click();
      fixture.detectChanges();
    };
    return { el, fixture, cmp, service, close, add, type, go };
  }

  it('標題與副標照稿：教室：分校名，副標列出「A 教室（30 人）」；沒填容量的只寫名字', () => {
    const { el } = setup();
    expect(el.textContent).toContain('教室：中正分校');
    const sub = el.querySelector('[data-rooms]')!.textContent!.replace(/\s+/g, '');
    expect(sub).toBe('A教室（30人）、B教室');
  });

  it('沒有教室：「這個分校還沒有教室」', () => {
    expect(setup([]).el.textContent).toContain('這個分校還沒有教室');
  });

  it('名稱沒填：送出鈕不鎖、寫出還差什麼，不送請求', () => {
    const { el, service, go } = setup();
    go();
    expect(service.createClassroom).not.toHaveBeenCalled();
    expect(el.textContent).toContain('還沒填：新增教室');
  });

  it('新增：容量預設 20、空設備送 null；toast 照稿，關掉回 true', () => {
    const { service, close, add, type, go } = setup();
    type('room-name', ' C 教室 ');
    go();
    expect(service.createClassroom).toHaveBeenCalledWith('cp-1', {
      name: 'C 教室',
      capacity: 20,
      equipment: null,
    });
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: '已在中正分校新增「C 教室」' }),
    );
    expect(close).toHaveBeenCalledWith(true);
  });

  it('容量留空送 null；不是正整數不送，寫原因', () => {
    const { el, service, type, go } = setup();
    type('room-name', 'C');
    type('room-capacity', '0');
    go();
    expect(service.createClassroom).not.toHaveBeenCalled();
    expect(el.textContent).toContain('容納人數要是大於 0 的整數');

    type('room-capacity', '');
    go();
    expect(service.createClassroom).toHaveBeenCalledWith(
      'cp-1',
      expect.objectContaining({ capacity: null }),
    );
  });

  it('同名（409）：寫在底部，不關、不清欄位', () => {
    const { el, service, close, type, go } = setup();
    service.createClassroom.mockReturnValueOnce(
      throwError(() => ({ error: { code: 'CLASSROOM_NAME_TAKEN' } })) as never,
    );
    type('room-name', 'A 教室');
    go();
    expect(close).not.toHaveBeenCalled();
    expect(el.textContent).toContain('中正分校已經有「A 教室」了');
    expect((el.querySelector('#room-name') as HTMLInputElement).value).toBe('A 教室');
  });

  it('改名：帶入那間的值，送 updateClassroom', async () => {
    const { fixture, cmp, service, type, go } = setup();
    cmp.startEditing(room('r1', 'A 教室'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    type('room-name', 'A1 教室');
    go();
    expect(service.updateClassroom).toHaveBeenCalledWith('cp-1', 'r1', {
      name: 'A1 教室',
      capacity: 30,
      equipment: null,
    });
  });

  it('刪除：就地確認後刪，副標拿掉那間，toast 寫受影響時段；關掉時回 true', () => {
    const { el, fixture, cmp, service, add, close } = setup();
    cmp.deleting.set(room('r1', 'A 教室'));
    fixture.detectChanges();
    expect(el.textContent).toContain('刪除「A 教室」？');
    [...el.querySelectorAll('[role="alert"] button')]
      .find((b) => b.textContent!.trim() === '刪除')!
      .dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(service.deleteClassroom).toHaveBeenCalledWith('cp-1', 'r1');
    expect(el.querySelector('[data-rooms]')!.textContent).not.toContain('A 教室');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ detail: '2 個時段改回不指定教室' }));
    cmp.close();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('讀清單失敗：寫出來、可重試，不說「還沒有教室」', () => {
    const { el, fixture, service } = setup();
    service.listClassrooms.mockReturnValueOnce(throwError(() => new Error('x')) as never);
    (fixture.componentInstance as any).load();
    fixture.detectChanges();
    expect(el.textContent).toContain('沒有讀到教室清單');
    expect(el.textContent).not.toContain('還沒有教室');
  });
});
