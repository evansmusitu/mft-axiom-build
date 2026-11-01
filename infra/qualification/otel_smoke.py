from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExportResult
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

provider = TracerProvider(resource=Resource.create({"service.name": "musitu-connect-qualification"}))
memory = InMemorySpanExporter()
provider.add_span_processor(SimpleSpanProcessor(memory))

with provider.get_tracer("musitu.connect.qualification").start_as_current_span("qualification-span") as span:
    span.set_attribute("qualification", "pass")

spans = memory.get_finished_spans()
assert len(spans) == 1, spans

exporter = OTLPSpanExporter(endpoint="http://127.0.0.1:4318/v1/traces", timeout=10)
result = exporter.export(spans)
exporter.shutdown()
assert result == SpanExportResult.SUCCESS, result

print("OPENTELEMETRY_OTLP_EXPORT=PASS")
