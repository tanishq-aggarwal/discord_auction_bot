export const SLAVE_SPECIALTIES = ["Base Builder", "Attacker", "All Rounder", "Water Boy"] as const;

export type SlaveSpecialty = (typeof SLAVE_SPECIALTIES)[number];

export function isSlaveSpecialty(value: unknown): value is SlaveSpecialty {
    return typeof value === "string" && (SLAVE_SPECIALTIES as readonly string[]).includes(value);
}
