import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '@env/environment';

const REMEMBER_ME_KEY = 'clessia:remember-me';

class ConditionalStorage {
  getItem(key: string): string | null {
    // Check both storages to ensure session restoration regardless of current flag state
    // Prioritize localStorage (persisted) if available
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  }

  setItem(key: string, value: string): void {
    const rememberMe = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
    if (rememberMe) {
      localStorage.setItem(key, value);
    } else {
      sessionStorage.setItem(key, value);
    }
  }

  removeItem(key: string): void {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(environment.supabase.url, environment.supabase.anonKey, {
      auth: { storage: new ConditionalStorage() },
    });
  }
}
