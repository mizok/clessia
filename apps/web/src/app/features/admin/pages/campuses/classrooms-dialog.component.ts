import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import type { Observable } from 'rxjs';

import { CampusesService, type Campus, type Classroom } from '@core/campuses.service';
import {
  A6_BTN,
  A6_BTN_CTA,
  A6_BTN_DANGER,
  A6_CLOSE,
  A6_DIALOG,
  A6_FOOT,
  A6_FORM,
  A6_INPUT,
  A6_LABEL,
} from './a6-form';

/**
 * 分校的教室（#1314 SE3，A6 settings.html#campuses「⋮ › 教室」的 `form()`）。
 *
 * 稿只畫了新增：標題「教室：○○」、副標列出現有教室、三個欄位、送出「新增教室」，送出後關掉。
 * 改名／刪除（使用者 10-21 裁 Q4）放在副標每間教室後面的小「⋯」（R2：稿沒畫的收進⋯）——
 * 改名把那間帶進同一組欄位，刪除在副標下就地確認（不疊第二個對話框）。
 *
 * 原生 `<dialog>`＋`showModal()`（同 admin/notifications、家長端請假）：Esc、焦點圈住、
 * 關掉焦點回入口由瀏覽器做。modal 在 top layer —— CDK overlay 的 popup-menu 會被蓋住，
 * 所以每間教室的「⋯」用原生 popover（也在 top layer，後開的在上）。
 */
@Component({
  selector: 'app-classrooms-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    <dialog
      #dialog
      [class]="a6.dialog"
      aria-labelledby="classrooms-title"
      (click)="onBackdrop($event)"
      (close)="onClosed()"
    >
      @if (campus(); as campus) {
        <div class="flex items-center justify-between pt-4 pr-4 pb-2 pl-6">
          <div>
            <h2 id="classrooms-title" class="m-0 text-xl font-bold">教室：{{ campus.name }}</h2>
            <p class="m-0 mt-0.5 text-md text-zinc-600" data-rooms>
              @if (loadFailed()) {
                沒有讀到教室清單。<button
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
                  <span class="whitespace-nowrap"
                    >{{ roomLabel(room)
                    }}<button
                      type="button"
                      class="-my-1 ml-0.5 inline-grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent align-middle text-zinc-700 hover:bg-zinc-100 max-wide:size-11"
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
          <button type="button" [class]="a6.close" aria-label="關閉" (click)="close()">
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>

        @if (deleting(); as room) {
          <div
            class="mx-6 mb-2 flex flex-wrap items-center gap-2 rounded-md bg-zinc-100 p-3 text-md max-wide:mx-4 max-wide:bg-white"
            role="alert"
          >
            <span class="mr-auto"
              >刪除「{{ room.name }}」？指定這間教室的時段會改回不指定教室。</span
            >
            <button type="button" [class]="btn" [disabled]="busy()" (click)="deleting.set(null)">
              取消
            </button>
            <button
              type="button"
              [class]="dangerBtn"
              [attr.aria-disabled]="busy()"
              (click)="remove(room)"
            >
              {{ busy() ? '刪除中…' : '刪除' }}
            </button>
          </div>
        }

        <!-- A6 .acset__body.fdlg__body：桌機兩欄（名稱、容量各半），手機一欄 -->
        <form ngNoForm [class]="a6.form" (submit)="$event.preventDefault(); submit()">
          <div class="min-w-0">
            <label [class]="a6.label" for="room-name"
              >{{ editing() ? '教室名稱' : '新增教室' }}
              <span class="text-error-700" aria-hidden="true">*</span></label
            >
            <input
              id="room-name"
              [attr.autofocus]="autofocus() ? '' : null"
              type="text"
              maxlength="50"
              autocomplete="off"
              placeholder="例如：C 教室"
              [class]="input"
              [ngModel]="name()"
              (ngModelChange)="name.set($event); error.set(null)"
            />
          </div>
          <div class="min-w-0">
            <label [class]="a6.label" for="room-capacity">容納人數</label>
            <input
              id="room-capacity"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              [class]="input"
              [(ngModel)]="capacity"
            />
          </div>
          <div class="col-span-full min-w-0">
            <label [class]="a6.label" for="room-equipment">設備（選填）</label>
            <input
              id="room-equipment"
              type="text"
              maxlength="200"
              autocomplete="off"
              placeholder="例如：投影機、白板"
              [class]="input"
              [(ngModel)]="equipment"
            />
          </div>
        </form>

        <!-- A6 .fdlg__foot：必填沒填不鎖死送出鈕，旁邊寫還差什麼（#723）；失敗訊息也寫這裡，填的內容不清。黏在捲動區底 -->
        <div [class]="a6.foot">
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
            [class]="ctaBtn"
            [attr.aria-disabled]="!!missingHint() || busy()"
            (click)="submit()"
          >
            {{ busy() ? (editing() ? '儲存中…' : '新增中…') : editing() ? '儲存' : '新增教室' }}
          </button>
        </div>
      }

      <!-- 每間教室的「⋯」：原生 popover，定位在按鈕下緣靠右（openRoomMenu） -->
      <div
        #roomMenu
        popover
        (toggle)="onMenuToggle($event)"
        class="m-0 min-w-36 rounded-lg border border-solid border-zinc-200 bg-white p-1 text-md text-zinc-900 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.08)]"
      >
        <button type="button" [class]="menuItem" (click)="startEditing()">
          <i class="pi pi-pencil text-sm" aria-hidden="true"></i>改名／修改
        </button>
        <button type="button" [class]="menuItem + ' text-error-700'" (click)="askDelete()">
          <i class="pi pi-trash text-sm" aria-hidden="true"></i>刪除
        </button>
      </div>
    </dialog>
  `,
})
export class ClassroomsDialogComponent {
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly roomMenu = viewChild.required<ElementRef<HTMLElement>>('roomMenu');

  /** 關掉時發出；`true` = 有新增／改／刪，列上的教室數要重數 */
  readonly closed = output<boolean>();

  protected readonly btn = A6_BTN;
  protected readonly ctaBtn = A6_BTN_CTA;
  protected readonly dangerBtn = A6_BTN_DANGER;
  protected readonly input = A6_INPUT;
  protected readonly a6 = {
    dialog: A6_DIALOG,
    close: A6_CLOSE,
    form: A6_FORM,
    label: A6_LABEL,
    foot: A6_FOOT,
  };
  protected readonly menuItem =
    'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3 text-left [font:inherit] hover:bg-zinc-100 max-wide:min-h-11';

  protected readonly campus = signal<Campus | null>(null);
  /** null = 還在讀 */
  protected readonly rooms = signal<Classroom[] | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly editing = signal<Classroom | null>(null);
  protected readonly deleting = signal<Classroom | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly name = signal('');
  /** 稿的預設 20 */
  protected capacity = '20';
  protected equipment = '';
  /** 桌機開啟時聚焦第一欄；沒有它焦點會落在副標的第一顆「⋯」或「重試」 */
  protected readonly autofocus = signal(false);
  /** 這一輪有沒有改過任何東西 */
  private changed = false;
  /** 選單開著沒（popover 的 toggle 事件維護；點外面 light dismiss 也會關） */
  private menuOpen = false;
  protected onMenuToggle(event: Event): void {
    this.menuOpen = (event as ToggleEvent).newState === 'open';
  }
  /** 「⋯」點的是哪一間 */
  private menuRoom: Classroom | null = null;

  protected readonly missingHint = computed(() =>
    this.name().trim() ? null : `還沒填：${this.editing() ? '教室名稱' : '新增教室'}`,
  );

  /** 每次打開都是新的一輪（同稿每次 new 一個 dialog） */
  open(campus: Campus): void {
    this.campus.set(campus);
    this.changed = false;
    this.deleting.set(null);
    this.busy.set(false);
    this.stopEditing();
    this.load();
    // 稿：桌機聚焦第一個欄位、手機不聚焦（不要一開就彈鍵盤）—— 交給 showModal 的 autofocus
    this.autofocus.set(matchMedia('(min-width: 861px)').matches);
    // 等 @if 把內容畫進 dialog 再 showModal（microtask 太早：內容還沒畫，焦點落在 dialog 本身）
    afterNextRender(() => this.dialog().nativeElement.showModal(), { injector: this.injector });
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  /**
   * 點背景（dialog 本身，不是裡面的東西）關掉，同 A6 `form()`。
   * **不能寫成模板裡的 `target === dialog && close()`**：點裡面時那個運算式回 false，
   * Angular 會當成 preventDefault —— radio 點不下去。
   */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  protected onClosed(): void {
    this.hideRoomMenu();
    this.closed.emit(this.changed);
  }

  protected load(): void {
    const campus = this.campus();
    if (!campus) return;
    this.loadFailed.set(false);
    this.rooms.set(null);
    this.campusesService.listClassrooms(campus.id).subscribe({
      next: (res) => this.rooms.set(res.data),
      error: () => this.loadFailed.set(true),
    });
  }

  protected roomLabel(room: Classroom): string {
    return room.capacity ? `${room.name}（${room.capacity} 人）` : room.name;
  }

  protected openRoomMenu(event: MouseEvent, room: Classroom): void {
    const menu = this.roomMenu().nativeElement;
    if (this.menuOpen && this.menuRoom?.id === room.id) {
      this.hideRoomMenu();
      return;
    }
    this.menuRoom = room;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // popover 是 fixed、在 top layer；右緣對齊按鈕右緣，貼在按鈕下方 4px
    menu.style.position = 'fixed';
    menu.style.inset = 'auto';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${document.documentElement.clientWidth - rect.right}px`;
    menu.showPopover();
  }

  private hideRoomMenu(): void {
    // 沒開時 hidePopover 什麼都不做；jsdom 沒有這支
    this.roomMenu().nativeElement.hidePopover?.();
  }

  protected startEditing(room: Classroom | null = this.menuRoom): void {
    this.hideRoomMenu();
    if (!room) return;
    this.deleting.set(null);
    this.editing.set(room);
    this.name.set(room.name);
    this.capacity = room.capacity === null ? '' : String(room.capacity);
    this.equipment = room.equipment ?? '';
    this.error.set(null);
  }

  protected askDelete(): void {
    this.hideRoomMenu();
    this.deleting.set(this.menuRoom);
  }

  protected stopEditing(): void {
    this.editing.set(null);
    this.name.set('');
    this.capacity = '20';
    this.equipment = '';
    this.error.set(null);
  }

  protected submit(): void {
    const campus = this.campus();
    if (!campus || this.busy() || this.missingHint()) return;
    const capacityText = this.capacity.trim();
    const capacity = capacityText ? Number(capacityText) : null;
    if (capacity !== null && !(Number.isInteger(capacity) && capacity > 0)) {
      this.error.set('容納人數要是大於 0 的整數，或留空');
      return;
    }
    const input = { name: this.name().trim(), capacity, equipment: this.equipment.trim() || null };
    const room = this.editing();
    const request$: Observable<unknown> = room
      ? this.campusesService.updateClassroom(campus.id, room.id, input)
      : this.campusesService.createClassroom(campus.id, input);

    this.busy.set(true);
    this.error.set(null);
    request$.subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: room ? `已儲存「${input.name}」` : `已在${campus.name}新增「${input.name}」`,
        });
        this.changed = true;
        this.busy.set(false);
        this.close();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(
          err.error?.code === 'CLASSROOM_NAME_TAKEN'
            ? `${campus.name}已經有「${input.name}」了`
            : (err.error?.error ?? '沒有存成功，請再試一次'),
        );
      },
    });
  }

  protected remove(room: Classroom): void {
    const campus = this.campus();
    if (!campus || this.busy()) return;
    this.busy.set(true);
    this.campusesService.deleteClassroom(campus.id, room.id).subscribe({
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
}
