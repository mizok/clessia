import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type { Observable } from 'rxjs';

import { CampusesService, type Campus, type Classroom } from '@core/campuses.service';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';

/**
 * 分校的教室（#1314 SE3，A6 settings.html#campuses「⋮ › 教室」的 form()）。
 *
 * 稿只畫了新增：標題「教室：○○」、副標列出現有教室、三個欄位、送出「新增教室」。
 * 改名／刪除（使用者 10-21 裁 Q4）放在副標每間教室後面的小「⋯」—— 改名把那間帶進同一組欄位，
 * 刪除在副標下就地確認（不疊第二個對話框）。送出後關掉對話框，跟稿一樣；關閉時回 true 讓列表重數教室。
 */
@Component({
  selector: 'app-classrooms-dialog',
  standalone: true,
  imports: [FormsModule, InputTextModule, PopupMenuComponent],
  template: `
    <div class="dialog-header-inline">
      <div class="dialog-header-inline__content flex-col items-start gap-1">
        <h2 class="m-0 text-xl font-bold" id="classrooms-title">教室：{{ campus.name }}</h2>
        <p class="m-0 text-md text-zinc-600" data-rooms>
          @if (loadFailed()) {
            沒有讀到教室清單。
            <button
              type="button"
              class="cursor-pointer border-0 bg-transparent p-0 font-semibold text-zinc-900 underline [font:inherit]"
              (click)="load()"
            >
              重試
            </button>
          } @else if (rooms() === null) {
            讀取中…
          } @else if (rooms()!.length === 0) {
            這個分校還沒有教室
          } @else {
            @for (room of rooms(); track room.id; let last = $last) {
              <span class="inline-flex items-center whitespace-nowrap"
                >{{ roomLabel(room)
                }}<button
                  type="button"
                  class="ml-0.5 inline-grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-zinc-700 hover:bg-zinc-100"
                  [attr.aria-label]="room.name + ' 的更多動作'"
                  (click)="openRoomMenu($event, room)"
                >
                  <i class="pi pi-ellipsis-h text-sm" aria-hidden="true"></i></button
                >{{ last ? '' : '、' }}</span
              >
            }
          }
        </p>
      </div>
      <button
        type="button"
        class="dialog-header-inline__close size-11"
        aria-label="關閉"
        (click)="close()"
      >
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>
    <app-popup-menu #roomMenu [model]="roomMenuItems()" />

    @if (deleting(); as room) {
      <div
        class="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-zinc-100 p-3 text-md"
        role="alert"
      >
        <span class="mr-auto">刪除「{{ room.name }}」？指定這間教室的時段會改回不指定教室。</span>
        <button type="button" [class]="btn" [disabled]="busy()" (click)="deleting.set(null)">
          取消
        </button>
        <button
          type="button"
          [class]="btn + ' border-error-700 bg-error-700 text-white hover:bg-error-700'"
          [attr.aria-disabled]="busy()"
          (click)="remove(room)"
        >
          {{ busy() ? '刪除中…' : '刪除' }}
        </button>
      </div>
    }

    <form
      ngNoForm
      class="grid grid-cols-1 gap-x-3 gap-y-4 wide:grid-cols-2"
      (submit)="$event.preventDefault(); submit()"
    >
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-md font-semibold text-zinc-700" for="room-name"
          >{{ editing() ? '教室名稱' : '新增教室' }}
          <span class="text-error-700" aria-hidden="true">*</span></label
        >
        <input
          id="room-name"
          type="text"
          pInputText
          maxlength="50"
          autocomplete="off"
          placeholder="例如：C 教室"
          [(ngModel)]="name"
          class="w-full"
        />
      </div>
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-md font-semibold text-zinc-700" for="room-capacity">容納人數</label>
        <input
          id="room-capacity"
          type="text"
          inputmode="numeric"
          pInputText
          autocomplete="off"
          [(ngModel)]="capacity"
          class="w-full"
        />
      </div>
      <div class="flex min-w-0 flex-col gap-1 wide:col-span-2">
        <label class="text-md font-semibold text-zinc-700" for="room-equipment">設備（選填）</label>
        <input
          id="room-equipment"
          type="text"
          pInputText
          maxlength="200"
          autocomplete="off"
          placeholder="例如：投影機、白板"
          [(ngModel)]="equipment"
          class="w-full"
        />
      </div>
    </form>

    <!-- A6 form() 底部：必填沒填不鎖死送出鈕，旁邊寫還差什麼（#723）；失敗訊息也寫這裡，填的內容不清 -->
    <div
      class="sticky bottom-0 z-[1] mt-5 flex flex-wrap items-center justify-end gap-2 bg-white pt-2"
    >
      <p
        class="m-0 mr-auto text-md max-wide:basis-full"
        [class.text-error-700]="!!error()"
        [class.text-zinc-600]="!error()"
        aria-live="polite"
      >
        {{ error() ?? missingHint() }}
      </p>
      <button
        type="button"
        [class]="btn"
        [disabled]="busy()"
        (click)="editing() ? stopEditing() : close()"
      >
        取消
      </button>
      <button
        type="button"
        [class]="
          btn +
          ' border-accent-vivid bg-accent-vivid hover:border-accent-vivid-2 hover:bg-accent-vivid-2'
        "
        [attr.aria-disabled]="!!missingHint() || busy()"
        (click)="submit()"
      >
        {{ busy() ? (editing() ? '儲存中…' : '新增中…') : editing() ? '儲存' : '新增教室' }}
      </button>
    </div>
  `,
})
export class ClassroomsDialogComponent {
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  protected readonly campus: Campus = inject(DynamicDialogConfig).data.campus;

  protected readonly btn =
    'inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-55 wide:h-9';

  /** null = 還在讀 */
  protected readonly rooms = signal<Classroom[] | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly editing = signal<Classroom | null>(null);
  protected readonly deleting = signal<Classroom | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** 有沒有改過任何東西 —— 關閉時告訴列表要不要重數 */
  private changed = false;

  // ngModel 雙向綁的是普通欄位；必填提示要跟著變，所以名字另外放一個 signal
  private readonly nameValue = signal('');
  protected get name(): string {
    return this.nameValue();
  }
  protected set name(value: string) {
    this.nameValue.set(value);
    this.error.set(null);
  }
  /** 稿的預設 20 */
  protected capacity = '20';
  protected equipment = '';

  protected readonly missingHint = computed(() =>
    this.nameValue().trim() ? null : `還沒填：${this.editing() ? '教室名稱' : '新增教室'}`,
  );

  protected readonly selectedRoom = signal<Classroom | null>(null);
  protected readonly roomMenuItems = computed<MenuItem[]>(() => {
    const room = this.selectedRoom();
    if (!room) return [];
    return [
      { label: '改名／修改', icon: 'pi pi-pencil', command: () => this.startEditing(room) },
      {
        label: '刪除',
        icon: 'pi pi-trash',
        itemClass: 'text-red-500',
        command: () => this.deleting.set(room),
      },
    ];
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loadFailed.set(false);
    this.rooms.set(null);
    this.campusesService.listClassrooms(this.campus.id).subscribe({
      next: (res) => this.rooms.set(res.data),
      error: () => this.loadFailed.set(true),
    });
  }

  protected roomLabel(room: Classroom): string {
    return room.capacity ? `${room.name}（${room.capacity} 人）` : room.name;
  }

  protected openRoomMenu(event: MouseEvent, room: Classroom): void {
    this.selectedRoom.set(room);
    this.roomMenu().toggle(event);
  }

  private readonly roomMenu = viewChild.required<PopupMenuComponent>('roomMenu');

  private startEditing(room: Classroom): void {
    this.deleting.set(null);
    this.editing.set(room);
    this.name = room.name;
    this.capacity = room.capacity === null ? '' : String(room.capacity);
    this.equipment = room.equipment ?? '';
  }

  protected stopEditing(): void {
    this.editing.set(null);
    this.name = '';
    this.capacity = '20';
    this.equipment = '';
  }

  protected submit(): void {
    if (this.busy() || this.missingHint()) return;
    const capacityText = this.capacity.trim();
    const capacity = capacityText ? Number(capacityText) : null;
    if (capacity !== null && !(Number.isInteger(capacity) && capacity > 0)) {
      this.error.set('容納人數要是大於 0 的整數，或留空');
      return;
    }
    const input = {
      name: this.name.trim(),
      capacity,
      equipment: this.equipment.trim() || null,
    };
    const room = this.editing();
    const request$: Observable<unknown> = room
      ? this.campusesService.updateClassroom(this.campus.id, room.id, input)
      : this.campusesService.createClassroom(this.campus.id, input);

    this.busy.set(true);
    this.error.set(null);
    request$.subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: room
            ? `已儲存「${input.name}」`
            : `已在${this.campus.name}新增「${input.name}」`,
        });
        this.ref.close(true);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(
          err.error?.code === 'CLASSROOM_NAME_TAKEN'
            ? `${this.campus.name}已經有「${input.name}」了`
            : (err.error?.error ?? '沒有存成功，請再試一次'),
        );
      },
    });
  }

  protected remove(room: Classroom): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.campusesService.deleteClassroom(this.campus.id, room.id).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.changed = true;
        this.deleting.set(null);
        if (this.editing()?.id === room.id) this.stopEditing();
        this.rooms.update((list) => list?.filter((r) => r.id !== room.id) ?? null);
        this.messageService.add({
          severity: 'success',
          summary: `已刪除「${room.name}」`,
          detail: res.affectedSchedules
            ? `${res.affectedSchedules} 個時段改回不指定教室`
            : undefined,
        });
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err.error?.error ?? `沒有刪掉「${room.name}」，請再試一次`);
      },
    });
  }

  protected close(): void {
    this.ref.close(this.changed);
  }
}
