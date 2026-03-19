import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { ClassesService, Class } from '@core/classes.service';

@Component({
  selector: 'app-class-picker-dialog',
  standalone: true,
  imports: [
    FormsModule, ButtonModule, InputTextModule, TagModule,
    SkeletonModule, IconFieldModule, InputIconModule,
  ],
  templateUrl: './class-picker-dialog.component.html',
  styleUrl: './class-picker-dialog.component.scss',
})
export class ClassPickerDialogComponent implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  protected readonly loading = signal(true);
  protected readonly classes = signal<Class[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = 20;
  protected readonly searchQuery = signal('');

  // 已加入的 classId 集合（從 config.data 傳入），用於過濾
  private readonly existingClassIds = new Set<string>(this.config.data?.existingClassIds ?? []);

  protected readonly filteredClasses = computed(() =>
    this.classes().filter((c) => !this.existingClassIds.has(c.id)),
  );

  ngOnInit(): void {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.currentPage.set(1);
        this.load();
      });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.classesService
      .list({
        search: this.searchQuery() || undefined,
        isActive: true,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.classes.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected onSearchChange(value: string): void {
    this.searchSubject.next(value);
  }

  protected select(cls: Class): void {
    this.ref.close(cls);
  }

  protected cancel(): void {
    this.ref.close();
  }
}
