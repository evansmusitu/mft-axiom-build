export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type TypeRef =
  | { kind: "number"; unit: string }
  | { kind: "decimal"; unit: string; scale: number }
  | { kind: "boolean" }
  | { kind: "string" }
  | { kind: "series"; element: TypeRef }
  | { kind: "record"; fields: Record<string, TypeRef> };

export interface Provenance {
  source: string;
  observedAt?: string;
  contentHash: string;
}

export interface TypedValue {
  type: TypeRef;
  value: JsonValue;
  provenance?: Provenance;
}

export type ValueRef = { input: string } | { node: string } | { literal: TypedValue };
export type NodeKind = "Transform" | "Hypothesis" | "Verify" | "Optimize" | "Decision";

export interface AxiomNode {
  id: string;
  kind: NodeKind;
  operation: string;
  inputs: Record<string, ValueRef>;
  params?: Record<string, JsonValue>;
}

export interface ConstraintSpec {
  id: string;
  node: string;
  statement: string;
  severity: "error" | "warning";
  expected: boolean;
}

export interface AxiomProgram {
  irVersion: "0.1";
  objective: string;
  assumptions: string[];
  inputs: Record<string, TypedValue>;
  nodes: AxiomNode[];
  constraints: ConstraintSpec[];
  decisionNodeId: string;
}

export interface VerificationResult {
  id: string;
  kind: "type" | "unit" | "provenance" | "constraint" | "signature" | "replay";
  ok: boolean;
  severity: "error" | "warning";
  message: string;
}

export interface TraceEntry {
  nodeId: string;
  operation: string;
  operationVersion: string;
  implementationHash: string;
  inputHash: string;
  outputHash: string;
}

export interface OperationManifestEntry {
  id: string;
  version: string;
  implementationHash: string;
  moduleHash: string;
}

export interface ExecutionResult {
  status: "COMPLETED";
  decisionStatus: "APPROVED" | "DENIED";
  programHash: string;
  inputMerkleRoot: string;
  outputs: Record<string, TypedValue>;
  trace: TraceEntry[];
  operationManifest: OperationManifestEntry[];
  verifications: VerificationResult[];
  executionHash: string;
}


export interface CompilerManifest {
  id:"axiom.phase1-compiler";
  version:string;
  implementationHash:string;
}
