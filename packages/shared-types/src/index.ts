/**
 * 前後端共用型別。
 *
 * **現況：三個 tsconfig 都設好了 `@clessia/shared-types` 別名，但沒有任何程式碼
 * import 它**（2026-09-04 盤點）。而它的內容是手寫的 interface，跟 `apps/api` 的
 * zod schema 各一份 —— 也就是說：**一個為了避免分岔而建的東西，因為沒人用而正在分岔。**
 *
 * 留著不刪，是因為門開著比重建便宜：
 *
 * - **`api-query-params` 那道 gate 不依賴它** —— 它比對的是 service 原始碼有沒有把
 *   參數當 query key 送出，跟型別住在哪無關
 * - **將來若要做完整的型別生成**（從 OpenAPI 文件生前端型別），那些型別就住這裡
 *
 * 在那之前，**不要往這裡加新的手寫型別** —— 那只會讓分岔更寬。
 */

// ============================================================
// User & Auth
// ============================================================

export type UserRole = 'admin' | 'teacher' | 'parent';

export interface User {
  id: string;
  email?: string | null;
  phone?: string | null;
  username?: string | null;
  displayName: string;
  roles: UserRole[];
  orgId: string;
  campusId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  phone: string | null;
}

// ============================================================
// Organization & Campus
// ============================================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campus {
  id: string;
  orgId: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Academic
// ============================================================

export interface Subject {
  id: string;
  orgId: string;
  name: string;
  sortOrder: number;
}

export interface Course {
  id: string;
  orgId: string;
  campusId: string;
  name: string;
  subjectId: string;
  subjectName: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Class {
  id: string;
  orgId: string;
  campusId: string;
  courseId: string;
  name: string;
  teacherId: string | null;
  maxStudents: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  orgId: string;
  campusId: string;
  name: string;
  grade: string | null;
  school: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// API Response
// ============================================================

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================
// Query Parameters
// ============================================================

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface SortParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterParams {
  search?: string;
  isActive?: boolean;
  campusId?: string;
}

export type ListParams = PaginationParams & SortParams & FilterParams;
