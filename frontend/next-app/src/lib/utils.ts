import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function display(value: unknown): string { if (value === null || value === undefined || value === '')
    return '—'; if (typeof value === 'boolean')
    return value ? 'Có' : 'Không'; if (typeof value === 'object')
    return JSON.stringify(value); return String(value); }
export function date(value: unknown) { if (!value)
    return '—'; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? display(value) : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(d); }
