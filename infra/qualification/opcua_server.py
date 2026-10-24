import asyncio
from asyncua import Server

async def main():
    server=Server()
    await server.init()
    server.set_endpoint("opc.tcp://0.0.0.0:4840/musitu/")
    await server.register_namespace("MUSITU")
    await server.start()
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        await server.stop()

if __name__=="__main__":
    asyncio.run(main())
