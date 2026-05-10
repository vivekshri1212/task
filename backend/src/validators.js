import { z } from "zod";

const dateField = z
  .string()
  .trim()
  .optional()
  .nullable()
  .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Date must be in YYYY-MM-DD format."
  });

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  email: z.string().trim().email("Enter a valid email."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .regex(/[A-Z]/, "Password must contain an uppercase letter.")
    .regex(/[a-z]/, "Password must contain a lowercase letter.")
    .regex(/[0-9]/, "Password must contain a number.")
});

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Password is required.")
});

export const projectSchema = z.object({
  name: z.string().trim().min(3, "Project name must be at least 3 characters."),
  description: z.string().trim().min(10, "Description must be at least 10 characters."),
  status: z.enum(["planning", "active", "completed", "on_hold"]),
  priority: z.enum(["low", "medium", "high"]),
  dueDate: dateField
});

export const taskSchema = z.object({
  title: z.string().trim().min(3, "Task title must be at least 3 characters."),
  description: z.string().trim().min(10, "Description must be at least 10 characters."),
  status: z.enum(["todo", "in_progress", "review", "done"]),
  priority: z.enum(["low", "medium", "high"]),
  dueDate: dateField,
  assignedTo: z.string().trim().min(1).optional().nullable()
});

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  email: z.string().trim().email("Enter a valid email.")
});

export const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .regex(/[A-Z]/, "Password must contain an uppercase letter.")
    .regex(/[a-z]/, "Password must contain a lowercase letter.")
    .regex(/[0-9]/, "Password must contain a number.")
});
