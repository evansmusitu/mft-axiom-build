import asyncio, uuid
from temporalio import workflow
from temporalio.client import Client
from temporalio.worker import Worker

@workflow.defn
class QualificationWorkflow:
    @workflow.run
    async def run(self) -> str:
        return "durable-ok"

async def main():
    client=await Client.connect("127.0.0.1:7233")
    task_queue="musitu-connect-qualification"
    worker=Worker(client,task_queue=task_queue,workflows=[QualificationWorkflow])
    worker_task=asyncio.create_task(worker.run(),name="musitu-connect-temporal-worker")
    try:
        result=await client.execute_workflow(
            QualificationWorkflow.run,
            id="connect-"+uuid.uuid4().hex,
            task_queue=task_queue
        )
        assert result=="durable-ok"
    finally:
        await worker.shutdown()
        await worker_task
    await asyncio.sleep(0)
    print("TEMPORAL_DURABILITY=PASS",flush=True)

if __name__=="__main__":
    with asyncio.Runner() as runner:
        runner.run(main())
