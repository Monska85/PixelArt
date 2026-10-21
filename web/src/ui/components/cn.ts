import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets the last Tailwind utility win. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
