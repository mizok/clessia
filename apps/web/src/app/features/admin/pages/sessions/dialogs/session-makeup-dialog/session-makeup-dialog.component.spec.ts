import { TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { SessionsService, type MakeupCandidate, type Session } from '@core/sessions.service';
import { SessionMakeupDialogComponent } from './session-makeup-dialog.component';

describe('SessionMakeupDialogComponent', () => {
  const candidates: MakeupCandidate[] = [
    { id: 'c1', sessionDate: '2026-09-04', startTime: '19:00', endTime: '21:00' },
    { id: 'c2', sessionDate: '2026-09-11', startTime: '19:00', endTime: '21:00' },
  ];

  const session = { id: 's1', makeupFor: null } as unknown as Session;

  let listSpy: ReturnType<typeof vi.fn>;
  let setSpy: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  function create(data: { session: Session } = { session }) {
    TestBed.resetTestingModule();
    listSpy = vi.fn().mockReturnValue(of({ data: candidates }));
    setSpy = vi.fn().mockReturnValue(of(undefined));
    close = vi.fn();
    add = vi.fn();
    TestBed.configureTestingModule({
      imports: [SessionMakeupDialogComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: MessageService, useValue: { add } },
        {
          provide: SessionsService,
          useValue: { listMakeupCandidates: listSpy, setMakeup: setSpy },
        },
      ],
    });
    const fixture = TestBed.createComponent(SessionMakeupDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * **前端不再過濾一次。** 排除條件（「還沒被補過」）在後端，而後端重用的是
   * 跟 DB partial unique index 同一份判定。前端加第三個載體就會漂移 ——
   * 那支 migration 正上方寫著後果：清單會列出索引會拒絕的選項，或藏起補得成的。
   */
  it('原樣顯示端點回的候選，不自己再篩一次', () => {
    const f = create();
    const options = (
      f.componentInstance as unknown as { options: () => { value: string }[] }
    ).options();

    expect(listSpy).toHaveBeenCalledWith('s1');
    expect(options.map((o) => o.value)).toEqual(['c1', 'c2']);
  });

  it('指定成功後回報 refresh', () => {
    const f = create();
    const c = f.componentInstance as unknown as {
      selectedId: { set: (v: string) => void };
      submit: () => void;
    };
    c.selectedId.set('c1');
    c.submit();

    expect(setSpy).toHaveBeenCalledWith('s1', 'c1');
    expect(close).toHaveBeenCalledWith('refresh');
  });

  /**
   * **這一段在正常流程裡看起來永遠不會發生 —— 但它不是死碼。**
   *
   * 清單已經隱藏了「已經被補過的」，所以使用者選不到那種選項。這個分支防的是
   * **時間差**：兩個人同時對同一堂停課指定補課，兩邊清單都顯示它可補，
   * 先送出的成功、後送出的撞上 DB 的 partial unique index。
   *
   * 1:1 是**資料層**強制的，清單只是快照 —— 所以提示必須**承接後端的 409**，
   * 前端自己判斷不出來。**沒有這條測試，下一個人很可能把那段當死碼刪掉。**
   */
  it('撞到 409 時提示並重新載入清單，不是當成一般錯誤', () => {
    const f = create();
    setSpy.mockReturnValue(
      throwError(() => ({ status: 409, error: { code: 'MAKEUP_TARGET_ALREADY_COVERED' } })),
    );
    const c = f.componentInstance as unknown as {
      selectedId: { set: (v: string | null) => void; (): string | null };
      submit: () => void;
    };
    c.selectedId.set('c1');
    c.submit();

    const toast = add.mock.calls.map((call) => call[0])[0] as { severity: string; summary: string };
    expect(toast.severity).toBe('warn');
    expect(toast.summary).toContain('已經有補課');
    // 重新取清單，讓被別人補走的那個選項消失
    expect(listSpy).toHaveBeenCalledTimes(2);
    // 沒有關掉對話框 —— 使用者要重選
    expect(close).not.toHaveBeenCalled();
  });

  it('非 409 的失敗走一般錯誤訊息，不會重新載入清單', () => {
    const f = create();
    setSpy.mockReturnValue(throwError(() => ({ status: 500, error: { error: '設定補課失敗' } })));
    const c = f.componentInstance as unknown as {
      selectedId: { set: (v: string) => void };
      submit: () => void;
    };
    c.selectedId.set('c1');
    c.submit();

    expect((add.mock.calls[0][0] as { severity: string }).severity).toBe('error');
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * 空清單有兩個成因（沒有停課、停課都被補走了），使用者分不出來 ——
   * 所以空狀態要講「為什麼空」。
   */
  it('沒有候選時說明「已經被補過的不會出現」', () => {
    listSpy = vi.fn().mockReturnValue(of({ data: [] }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SessionMakeupDialogComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: { session } } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: SessionsService,
          useValue: { listMakeupCandidates: listSpy, setMakeup: vi.fn() },
        },
      ],
    });
    const f = TestBed.createComponent(SessionMakeupDialogComponent);
    f.detectChanges();

    expect(f.nativeElement.textContent).toContain('已經被別的課堂補過的不會出現在這裡');
  });

  /** 這個系統做不出額外的單堂課，對話框要明說（#592） */
  it('明說系統無法新增單堂課', () => {
    const f = create();
    expect(f.nativeElement.textContent).toContain('系統無法新增單堂課');
  });
});
