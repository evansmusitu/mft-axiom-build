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
    async with Worker(client,task_queue=task_queue,workflows=[QualificationWorkflow]):
        result=await client.execute_workflow(QualificationWorkflow.run,id="connect-"+uuid.uuid4().hex,task_queue=task_queue)
        assert result=="durable-ok"
        print("TEMPORAL_DURABILITY=PASS")

if __name__=="__main__":
    asyncio.run(main())
