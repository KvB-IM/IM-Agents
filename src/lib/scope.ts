import "server-only";

/**
 * Tenant scoping, made structural (SOFTWARE_SCOPE.md section 7.1).
 *
 * This app reaches Zoho through ONE service-account connection, so Zoho will
 * happily return the entire book of business to any caller. The filter that
 * keeps a field agent inside their own production is written here, in this app,
 * and a single forgotten `where` clause exposes everything.
 *
 * So it is not a filter each route is trusted to remember. An AgentScope cannot
 * be constructed without an agent id, every read takes one, and the criteria
 * string is built here rather than assembled at each call site.
 */
export class AgentScope {
  private constructor(
    readonly agentId: string,
    readonly agentName: string,
  ) {}

  /** The only way to get one. */
  static forAgent(agentId: string, agentName: string): AgentScope {
    if (!agentId) throw new Error("AgentScope requires an agent id.");
    if (!agentName) throw new Error("AgentScope requires an agent name.");
    return new AgentScope(agentId, agentName);
  }

  /**
   * Zoho COQL criteria restricting a JOTS read to this agent's own forms.
   *
   * Matches on Submitting_Field_Agent — labelled "Accredited Field Agent" in
   * Zoho, and confirmed by field metadata to be a picklist backed by the
   * `Agent` global picklist (id 5102272000006932237). Not a user lookup and
   * not free text, so a name comparison is the correct and only comparison
   * available.
   *
   * The consequence worth knowing: an agent who is not on that global picklist
   * cannot be attributed at all. Onboarding a field agent is a Zoho picklist
   * change as well as an account in this app.
   */
  jotCriteria(): string {
    return `(Submitting_Field_Agent:equals:${this.agentName})`;
  }

  /** True when a record belongs to this agent. Used to guard single reads,
   *  where a criteria string does not apply. */
  owns(record: { submittingFieldAgent?: string }): boolean {
    return record.submittingFieldAgent === this.agentName;
  }
}
