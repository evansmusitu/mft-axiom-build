from typing import Any


class MqttTransport:
    def __init__(self,host:str="127.0.0.1",port:int=1883): self.host,self.port=host,port

    def _client_and_subscription(self,topic:str,timeout:float):
        import threading
        import paho.mqtt.client as mqtt
        subscribed=threading.Event()
        received=[]
        client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.on_message=lambda _c,_u,msg: received.append(msg.payload)
        client.on_subscribe=lambda *_args: subscribed.set()
        client.connect(self.host,self.port,60)
        client.loop_start()
        result,_mid=client.subscribe(topic,qos=1)
        if result != mqtt.MQTT_ERR_SUCCESS:
            client.loop_stop(); client.disconnect()
            raise RuntimeError(f"mqtt_subscribe_failed:{result}")
        if not subscribed.wait(timeout=min(timeout,5.0)):
            client.loop_stop(); client.disconnect()
            raise TimeoutError("mqtt_subscribe_timeout")
        return client,received

    def receive(self,topic:str,timeout:float=5.0)->bytes:
        import time
        client,received=self._client_and_subscription(topic,timeout)
        try:
            deadline=time.time()+timeout
            while time.time()<deadline and not received: time.sleep(.02)
        finally:
            client.loop_stop(); client.disconnect()
        if not received: raise TimeoutError("mqtt_receive_timeout")
        return received[0]

    def roundtrip(self,topic:str,payload:bytes,timeout:float=5.0)->bytes:
        import time
        import paho.mqtt.client as mqtt
        client,received=self._client_and_subscription(topic,timeout)
        try:
            info=client.publish(topic,payload,qos=1)
            info.wait_for_publish(timeout=timeout)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                raise RuntimeError(f"mqtt_publish_failed:{info.rc}")
            deadline=time.time()+timeout
            while time.time()<deadline and not received: time.sleep(.02)
        finally:
            client.loop_stop(); client.disconnect()
        if not received: raise TimeoutError("mqtt_roundtrip_timeout")
        return received[0]


class OpcUaTransport:
    def __init__(self,url:str): self.url=url
    async def read(self,node_id:str)->Any:
        values=await self.read_many([node_id])
        return values[0]
    async def read_many(self,node_ids:list[str])->list[Any]:
        from asyncua import Client
        async with Client(url=self.url) as client:
            return [await client.get_node(node_id).read_value() for node_id in node_ids]
