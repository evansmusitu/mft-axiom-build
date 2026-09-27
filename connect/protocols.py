from typing import Any

class MqttTransport:
    def __init__(self,host:str="127.0.0.1",port:int=1883): self.host,self.port=host,port
    def roundtrip(self,topic:str,payload:bytes,timeout:float=5.0)->bytes:
        import time
        import paho.mqtt.client as mqtt
        received=[]
        client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.on_message=lambda _c,_u,msg: received.append(msg.payload)
        client.connect(self.host,self.port,60); client.subscribe(topic,qos=1); client.loop_start()
        client.publish(topic,payload,qos=1).wait_for_publish()
        deadline=time.time()+timeout
        while time.time()<deadline and not received: time.sleep(.05)
        client.loop_stop(); client.disconnect()
        if not received: raise TimeoutError("mqtt_roundtrip_timeout")
        return received[0]

class OpcUaTransport:
    def __init__(self,url:str): self.url=url
    async def read(self,node_id:str)->Any:
        from asyncua import Client
        async with Client(url=self.url) as client:
            return await client.get_node(node_id).read_value()
