from typing import Any

class ConnectTelemetry:
    def __init__(self,service_name:str,endpoint:str="http://127.0.0.1:4318/v1/traces")->None:
        self.service_name=service_name
        self.endpoint=endpoint
        self._provider=None
    def start(self)->Any:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        provider=TracerProvider(resource=Resource.create({"service.name":self.service_name}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=self.endpoint)))
        trace.set_tracer_provider(provider)
        self._provider=provider
        return provider
