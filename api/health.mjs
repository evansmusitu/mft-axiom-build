export default {
  async fetch() {
    const configured = Boolean(
      process.env.AXIOM_OPERATOR_TOKEN &&
      process.env.AXIOM_OPERATOR_INTERNAL_TOKEN &&
      process.env.BLOB_READ_WRITE_TOKEN
    );
    return Response.json({
      schema: "musitu.axiom.operator-remote-health.v1",
      status: configured ? "READY" : "CONFIGURATION_INCOMPLETE",
      surface: "PRIVATE_OPERATOR_REMOTE",
      durable_state: configured ? "PRIVATE_BLOB_ETAG_CAS" : "UNAVAILABLE",
      production_authority: false,
      public_submission_mutation_authority: false,
      external_provider_execution_authority: false
    }, {
      status: configured ? 200 : 503,
      headers: {"cache-control":"no-store"}
    });
  }
};
