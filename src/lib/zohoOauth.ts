/**
 * The Zoho OAuth client's identity and the scopes it asks for.
 *
 * Kept apart from lib/zoho.ts (which is `server-only` and holds the API client)
 * and from lib/zohoToken.ts (which touches the database), so the OAuth routes
 * can import the scope list without dragging either in.
 */

/**
 * Scopes requested at authorisation.
 *
 * `JOTS` is a custom module — internally `CrmCustomModule18` — so the custom
 * module scopes are the ones that cover it.
 *
 * Deliberately NO DELETE. Nothing in this app deletes a CRM record, and a
 * service credential that cannot delete is one fewer way for a bug or a
 * compromise to destroy the book of business.
 *
 * `settings.fields.READ` is for picklist metadata: stage and relationship
 * values are currently pinned in code, and this is what lets them be read from
 * Zoho instead so a value added there stops being invisible here.
 */
export const ZOHO_SCOPES = [
  "ZohoCRM.modules.custom.READ",
  "ZohoCRM.modules.custom.CREATE",
  "ZohoCRM.modules.custom.UPDATE",
  "ZohoCRM.coql.READ",
  "ZohoCRM.settings.fields.READ",
] as const;

/** True when the app's own client credentials are configured. */
export function zohoClientConfigured(): boolean {
  return Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
}
