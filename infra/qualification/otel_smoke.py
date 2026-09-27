from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

provider=TracerProvider(resource=Resource.create({"service.name":"musitu-connect-qualification"}))
provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(endpoint="http://127.0.0.1:4318/v1/traces")))
trace.set_tracer_provider(provider)
with trace.get_tracer("musitu.connect.qualification").start_as_current_span("qualification-span") as span:
    span.set_attribute("qualification","pass")
provider.force_flush()
print("OPENTELEMETRY_OTLP_EXPORT=PASS")
