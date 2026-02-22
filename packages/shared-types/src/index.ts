// ============================================================
// User & Auth
// ============================================================

export type UserRole = 'admin' | 'teacher' | 'parent';

export interface User {
  id: string;
  email: string;
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
