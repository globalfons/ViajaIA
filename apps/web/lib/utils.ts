import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const num = new Intl.NumberFormat("es-ES");

export const formatUsd = (v: number) => eur.format(v);
export const formatNumber = (v: number) => num.format(v);
export const formatDate = (v: string | Date) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v));
