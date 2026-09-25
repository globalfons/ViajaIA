"use client";

import { Select } from "@/components/ui/input";

/** Submits the parent form (switchOrganization server action) on change. */
export function OrgSelect({ current, options }: { current: string; options: { id: string; name: string }[] }) {
  return (
    <Select
      name="organizationId"
      defaultValue={current}
      aria-label="Organización activa"
      className="w-40 sm:w-56"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}
