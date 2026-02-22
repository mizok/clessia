import { z } from 'zod';

// ============================================================
// Auth Schemas
// ============================================================

export const loginSchema = z.object({
  email: z.email('請輸入有效的電子郵件'),
  password: z.string().min(6, '密碼至少需要 6 個字元'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.email('請輸入有效的電子郵件'),
  password: z.string().min(6, '密碼至少需要 6 個字元'),
  displayName: z.string().min(2, '姓名至少需要 2 個字元').max(50, '姓名不可超過 50 個字元'),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email('請輸入有效的電子郵件'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(6, '密碼至少需要 6 個字元'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: '密碼不一致',
  path: ['confirmPassword'],
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ============================================================
// Campus Schemas
// ============================================================

export const createCampusSchema = z.object({
  name: z.string().min(1, '請輸入分校名稱').max(50, '分校名稱不可超過 50 個字元'),
  address: z.string().max(200, '地址不可超過 200 個字元').nullable().optional(),
  phone: z.string().max(20, '電話不可超過 20 個字元').nullable().optional(),
});

export type CreateCampusInput = z.infer<typeof createCampusSchema>;

export const updateCampusSchema = createCampusSchema.extend({
  isActive: z.boolean().optional(),
});

export type UpdateCampusInput = z.infer<typeof updateCampusSchema>;

// ============================================================
// Course Schemas
// ============================================================

export const createCourseSchema = z.object({
  campusId: z.uuid('請選擇分校'),
  name: z.string().min(1, '請輸入課程名稱').max(50, '課程名稱不可超過 50 個字元'),
  subjectId: z.uuid('請選擇科目'),
  description: z.string().max(500, '說明不可超過 500 個字元').nullable().optional(),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = z.object({
  name: z.string().min(1, '請輸入課程名稱').max(50, '課程名稱不可超過 50 個字元').optional(),
  subjectId: z.uuid('請選擇科目').optional(),
  description: z.string().max(500, '說明不可超過 500 個字元').nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

// ============================================================
// Class Schemas
// ============================================================

export const createClassSchema = z.object({
  campusId: z.uuid('請選擇分校'),
  courseId: z.uuid('請選擇課程'),
  name: z.string().min(1, '請輸入班級名稱').max(50, '班級名稱不可超過 50 個字元'),
  teacherId: z.uuid().nullable().optional(),
  maxStudents: z.number().int().min(1).max(100).nullable().optional(),
});

export type CreateClassInput = z.infer<typeof createClassSchema>;

export const updateClassSchema = z.object({
  name: z.string().min(1, '請輸入班級名稱').max(50, '班級名稱不可超過 50 個字元').optional(),
  teacherId: z.uuid().nullable().optional(),
  maxStudents: z.number().int().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateClassInput = z.infer<typeof updateClassSchema>;

// ============================================================
// Student Schemas
// ============================================================

export const createStudentSchema = z.object({
  campusId: z.uuid('請選擇分校'),
  name: z.string().min(1, '請輸入學生姓名').max(50, '學生姓名不可超過 50 個字元'),
  grade: z.string().max(20, '年級不可超過 20 個字元').nullable().optional(),
  school: z.string().max(50, '學校名稱不可超過 50 個字元').nullable().optional(),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = z.object({
  name: z.string().min(1, '請輸入學生姓名').max(50, '學生姓名不可超過 50 個字元').optional(),
  grade: z.string().max(20, '年級不可超過 20 個字元').nullable().optional(),
  school: z.string().max(50, '學校名稱不可超過 50 個字元').nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

// ============================================================
// Query Schemas
// ============================================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export const listQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  isActive: z.coerce.boolean().optional(),
  campusId: z.uuid().optional(),
});

export type ListQueryInput = z.infer<typeof listQuerySchema>;

// ============================================================
// ID Param Schema
// ============================================================

export const idParamSchema = z.object({
  id: z.uuid('無效的 ID 格式'),
});

export type IdParam = z.infer<typeof idParamSchema>;
