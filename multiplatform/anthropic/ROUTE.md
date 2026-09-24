# Anthropic route

Remote MCP is the primary distribution path for a cloud-hosted Axiom service. Claude custom remote connectors accept HTTPS MCP servers and support OAuth-based connection patterns.

The Anthropic Messages API also supports a remote MCP connector for tool calling. The provider adapter in this lane targets that interface while keeping the Axiom endpoint isolated from the current production review surface.

MCPB is prepared for local Claude Desktop distribution. Current Anthropic guidance says developers can submit extension details through its desktop-extension interest form; Team and Enterprise organizations can also upload custom .mcpb extensions internally.

No Anthropic directory submission or approval is claimed by this repository.
