"""Bounded legal/support page reachability cannot self-authorize a release."""
import unittest
from qualification.diagnose_axiom_public_pages import assess_public_page, URLS


class PublicPageTests(unittest.TestCase):
    def test_public_html_is_observed_but_not_legal_approval(self):
        page = b'<!doctype html><html><title>Public page</title>' + b'x' * 400 + b'</html>'
        record = assess_public_page('privacy', 200, 'text/html; charset=utf-8', page)
        self.assertEqual(record['status'], 'PUBLIC_HTML_OBSERVED_NOT_LEGALLY_APPROVED')
        self.assertFalse(record['legal_signoff_verified'])
        self.assertFalse(record['commercial_ga_qualified'])
        self.assertFalse(record['openai_submission_approved'])

    def test_bad_status_challenge_mime_and_size_fail_closed(self):
        html = b'<!doctype html><html>' + b'x' * 450 + b'</html>'
        cases = [(403, 'text/html', html),
                 (200, 'application/json', b'{}'),
                 (200, 'text/html', b'<html>tiny</html>'),
                 (200, 'text/html', b'<html>cf-chl-test' + b'x' * 500),
                 (200, 'text/html', b'<html>' + b'x' * 600000)]
        for status, mime, body in cases:
            with self.subTest(status=status, size=len(body)):
                report = assess_public_page('terms', status, mime, body)
                self.assertEqual(report['status'], 'PUBLIC_HTML_NOT_CONFIRMED')
                self.assertFalse(report['commercial_ga_qualified'])

    def test_unknown_url_never_allowed(self):
        report = assess_public_page('unknown', 200, 'text/html',
                                    b'<!doctype html>' + b'x' * 400)
        self.assertEqual(report['status'], 'UNAUTHORIZED_PAGE_IDENTIFIER')
        self.assertEqual(set(URLS), {'privacy', 'terms', 'docs', 'support'})


if __name__ == '__main__':
    unittest.main()
