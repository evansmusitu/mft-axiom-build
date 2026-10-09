"""HTTPS transport contract tests. All connections are in-memory fakes."""
import unittest
from model_https_transport import fixed_openai_transport, ProviderTransportRejected


class Response:
    def __init__(self, status=200, body=b'{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'):
        self.status=status
        self._body=body
    def read(self, limit):
        return self._body[:limit]


class FakeConnection:
    def __init__(self, host, timeout):
        self.host, self.timeout = host, timeout
        self.last=None
        self.response=Response()
        self.closed=False
    def request(self, method, path, body, headers):
        self.last=(method,path,body,headers)
    def getresponse(self):
        return self.response
    def close(self):
        self.closed=True


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.connections=[]
        def factory(host, timeout):
            conn=FakeConnection(host,timeout)
            self.connections.append(conn)
            return conn
        self.factory=factory
        self.body={'model':'gpt-4.1-mini','messages':[{'role':'user','content':'ping'}],
                   'max_completion_tokens':50,'stream':False}

    def send(self, host='api.openai.com',path='/v1/chat/completions', key='test-secret-token'):
        return fixed_openai_transport(host,path,key,self.body,20,connection_factory=self.factory)

    def test_pins_https_origin_path_credentials_and_explicit_timeout(self):
        result=self.send()
        self.assertEqual(result['choices'][0]['message']['content'],'ok')
        self.assertEqual(len(self.connections),1)
        conn=self.connections[0]
        self.assertEqual(conn.host,'api.openai.com')
        self.assertEqual(conn.timeout,20)
        self.assertEqual(conn.last[0:2],('POST','/v1/chat/completions'))
        self.assertEqual(conn.last[3]['Authorization'],'Bearer test-secret-token')
        self.assertTrue(conn.closed)

    def test_refuses_ssrf_and_url_override_before_network(self):
        invalid=[
            ('127.0.0.1','/v1/chat/completions'),
            ('api.openai.com.evil.org','/v1/chat/completions'),
            ('api.openai.com:8443','/v1/chat/completions'),
            ('https://api.openai.com','/v1/chat/completions'),
            ('api.openai.com','//evil.com'),
            ('api.openai.com','/v1/chat/completions?url=http://internal'),
            ('api.openai.com','/v1/models'),
        ]
        for host,path in invalid:
            with self.subTest(host=host,path=path), self.assertRaises(ProviderTransportRejected):
                self.send(host=host,path=path)
        self.assertEqual(self.connections,[])

    def test_rejects_redirect_and_http_error_without_leaking_credential(self):
        for code in (301,302,307,401,429,500):
            with self.subTest(status=code):
                def factory(host,timeout):
                    con=FakeConnection(host,timeout)
                    con.response=Response(status=code,body=b'error token=test-secret-token')
                    self.connections.append(con)
                    return con
                with self.assertRaises(ProviderTransportRejected) as context:
                    fixed_openai_transport('api.openai.com','/v1/chat/completions',
                                          'test-secret-token',self.body,20,connection_factory=factory)
                self.assertNotIn('test-secret-token',str(context.exception))
                self.assertTrue(self.connections[-1].closed)

    def test_rejects_oversized_and_non_json_result(self):
        for payload in (b'Z'*1048577,b'<html></html>',b'[]',b'{"error":"bad"}'):
            def factory(host,timeout):
                con=FakeConnection(host,timeout)
                con.response=Response(body=payload)
                return con
            with self.subTest(payload_len=len(payload)), self.assertRaises(ProviderTransportRejected):
                fixed_openai_transport('api.openai.com','/v1/chat/completions',
                                      'test-secret-token',self.body,20,connection_factory=factory)

    def test_denies_bad_credentials_and_payload(self):
        for credential in ('','naughty\nInjected: header',None):
            with self.subTest(credential=credential), self.assertRaises(ProviderTransportRejected):
                self.send(key=credential)
        self.assertEqual(self.connections,[])


if __name__=='__main__':
    unittest.main()
