import threading
import unittest

from benchmarks.mining_adapter.mqtt_field_runner import FieldSession


class _Reason:
    is_failure=False


class _Client:
    def __init__(self):
        self.calls=[]
    def subscribe(self, topic, qos):
        self.calls.append((topic,qos))
        return (0,17)


class FieldSessionRecoveryTests(unittest.TestCase):
    def test_subscriber_is_ready_only_after_suback(self):
        session=object.__new__(FieldSession)
        session.topic_root="musitu/field/test"
        session.qos=1
        session.lock=threading.RLock()
        session.errors=[]
        session.sub_connected=threading.Event()
        client=_Client()

        session._on_sub_connect(client,None,None,_Reason(),None)
        self.assertFalse(
            session.sub_connected.is_set(),
            "TCP reconnect must not be treated as subscription readiness",
        )

        session._on_subscribe(client,None,17,[1],None)
        self.assertTrue(session.sub_connected.is_set())


if __name__=="__main__":
    unittest.main()
