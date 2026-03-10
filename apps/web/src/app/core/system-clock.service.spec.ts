import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';

import { SystemClockService } from './system-clock.service';

describe('SystemClockService', () => {
  let service: SystemClockService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SystemClockService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('syncs from server when initialize is called', async () => {
    const initializePromise = service.initialize();
    const request = httpTestingController.expectOne('http://localhost:8787/system-time');
    request.flush({ epochMs: 1700000000000, iso: '2023-11-14T22:13:20.000Z' });
    await initializePromise;

    expect(service.synced()).toBe(true);
    expect(service.lastError()).toBeNull();
    expect(service.nowEpochMs()).toBeGreaterThanOrEqual(1700000000000);
  });

  it('stores sync error when server sync fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const syncPromise = service.syncWithServer();
    const request = httpTestingController.expectOne('http://localhost:8787/system-time');
    request.flush({ error: 'failed' }, { status: 500, statusText: 'Server Error' });
    await syncPromise;

    expect(service.synced()).toBe(false);
    expect(service.lastError()).toBe('SYNC_FAILED');
    consoleErrorSpy.mockRestore();
  });
});
