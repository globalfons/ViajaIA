import type { FetchLike } from "../llm/providers/http";
import type { ContactInput, CrmSync } from "./types";

/**
 * HubSpot adapter (CRM v3 objects API). Uses a private-app access token the
 * client stores as an encrypted secret (HUBSPOT_ACCESS_TOKEN).
 */
export class HubSpotSync implements CrmSync {
  readonly name = "hubspot";
  private readonly fetchImpl: FetchLike;
  constructor(
    private readonly token: string,
    opts: { fetchImpl?: FetchLike; baseUrl?: string } = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.base = opts.baseUrl ?? "https://api.hubapi.com";
  }
  private readonly base: string;

  private async call(path: string, body: unknown, method = "POST") {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`HubSpot HTTP ${res.status}`);
    return json;
  }

  async upsertContact(input: ContactInput & { lifecycleStage?: string }): Promise<{ externalId: string }> {
    const [firstname, ...rest] = (input.name ?? "").trim().split(/\s+/);
    const properties: Record<string, string> = {};
    if (input.email) properties.email = input.email;
    if (firstname) properties.firstname = firstname;
    if (rest.length) properties.lastname = rest.join(" ");
    if (input.phone) properties.phone = input.phone;
    if (input.company) properties.company = input.company;
    if (input.lifecycleStage) properties.lifecyclestage = input.lifecycleStage;
    if (input.email) {
      const found = (await this.call("/crm/v3/objects/contacts/search", {
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: input.email }] }],
        limit: 1,
      })) as { results?: { id: string }[] };
      const id = found.results?.[0]?.id;
      if (id) {
        await this.call(`/crm/v3/objects/contacts/${id}`, { properties }, "PATCH");
        return { externalId: id };
      }
    }
    const created = (await this.call("/crm/v3/objects/contacts", { properties })) as { id: string };
    return { externalId: created.id };
  }
}
