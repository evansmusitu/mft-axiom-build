import subprocess
import unittest
from qualification.retry_compose_pull import pull_qualified_images


class PullRetryTests(unittest.TestCase):
    def test_network_timeout_then_success_retries_same_exact_compose_pull(self):
        calls=[];sleeps=[]
        def runner(args, **kw):
            calls.append((args,kw))
            return subprocess.CompletedProcess(args, 1 if len(calls)==1 else 0,
                                               '', 'context deadline exceeded' if len(calls)==1 else '')
        success=pull_qualified_images(compose_file='infra/qualification/docker-compose.yml',
                                     runner=runner,sleeper=sleeps.append)
        self.assertEqual(success,2)
        self.assertEqual(sleeps,[8])
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[0][0],calls[1][0])
        self.assertIn('pull',calls[0][0])
        self.assertNotIn('--ignore-pull-failures',calls[0][0])

    def test_unauthorized_registry_fails_without_retry(self):
        calls=[]
        def runner(args,**kw):
            calls.append(args)
            return subprocess.CompletedProcess(args,1,'','unauthorized: authentication required')
        with self.assertRaisesRegex(RuntimeError,'pull_failed_nontransient'):
            pull_qualified_images(compose_file='infra/qualification/docker-compose.yml',runner=runner,sleeper=lambda _:None)
        self.assertEqual(len(calls),1)

    def test_persistent_timeout_stops_after_four_attempts(self):
        attempts=[];sleep=[]
        def runner(args,**kw):
            attempts.append(args)
            return subprocess.CompletedProcess(args,1,'','TLS handshake timeout')
        with self.assertRaisesRegex(RuntimeError,'pull_failed_after_retries'):
            pull_qualified_images(compose_file='infra/qualification/docker-compose.yml',runner=runner,sleeper=sleep.append)
        self.assertEqual(len(attempts),4)
        self.assertEqual(sleep,[8,16,24])

    def test_command_does_not_start_infrastructure_or_modify_production(self):
        calls=[]
        def runner(args,**kw):
            calls.append(args)
            return subprocess.CompletedProcess(args,0,'','')
        self.assertEqual(pull_qualified_images(compose_file='infra/qualification/docker-compose.yml',runner=runner,sleeper=lambda _:None),1)
        self.assertEqual(calls,[['docker','compose','-f','infra/qualification/docker-compose.yml','pull','--quiet']])

if __name__=='__main__':unittest.main()
