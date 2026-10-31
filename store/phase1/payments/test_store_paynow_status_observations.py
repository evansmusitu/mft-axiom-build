"""Disposable SQLite qualification for Store V2 Paynow observation ledger candidate.

Never runs against real Store, Neon, Paynow, customer or production records.
"""
from __future__ import annotations
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
BASE = ROOT / 'store-axiom-checkout-schema.sql'
CANDIDATE = ROOT / 'store-paynow-status-observations.candidate.sql'
D1 = 'a' * 64
D2 = 'b' * 64
POLL1 = 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444'
POLL2 = 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-555555555555'
REF1 = 'STORE-ABCDEF0123456789'
REF2 = 'STORE-1234567890ABCDEF'

class ObservationsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(BASE.read_text())
        self.db.executescript(CANDIDATE.read_text())
        self.db.execute("INSERT INTO store_products(sku, amount_cents, currency, publisher_type, status) VALUES ('OWNER_TEST', 425, 'USD', 'first_party', 'approved')")
        self.make_order(REF1, POLL1)
        self.make_order(REF2, POLL2)

    def tearDown(self):
        self.db.close()

    def make_order(self, ref, poll):
        self.db.execute("INSERT INTO store_checkout_intents(reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at) VALUES (?, 'OWNER_TEST_CUSTOMER', 'OWNER_TEST', 425, 'USD','initiating','2026-10-27T18:00:00Z','2026-10-28T18:00:00Z')", (ref,))
        self.db.execute("UPDATE store_checkout_intents SET status='pending',browser_url='https://www.paynow.co.zw/Payment/ConfirmPayment/1234',poll_url=? WHERE reference=?", (poll,ref))

    def observe(self, *, event_id='evt-001', reference=REF1, provider_reference='PAYNOW-ABC-123', status='Cancelled', amount=425, poll=POLL1, cb=D1, polled=D2):
        self.db.execute('''INSERT INTO store_paynow_status_observations
          (event_id,reference,paynow_reference,provider_status,amount_cents,currency,poll_url,callback_digest,poll_digest,observed_at)
          VALUES (?,?,?,?,?,'USD',?,?,?,?)''',
          (event_id,reference,provider_reference,status,amount,poll,cb,polled,'2026-10-27T21:00:00Z'))

    def test_migration_adds_only_append_only_review_observation_table(self):
        tables={v[0] for v in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn('store_paynow_status_observations',tables)
        self.assertNotIn('billing_subscriptions', tables)
        self.assertNotIn('store_entitlements',tables)
        self.assertNotIn('store_publisher_payouts',tables)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],0)

    def test_valid_cancelled_disputed_held_and_created_states_recorded_as_audit_only(self):
        for n,status in enumerate(['Created','Sent','Cancelled','Disputed','Awaiting Delivery','Delivered'],1):
            self.observe(event_id=f'evt-{n:03}',status=status,cb=f'{n:064x}',polled=f'{n+100:064x}')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],6)
        self.assertEqual(self.db.execute('SELECT status FROM store_checkout_intents WHERE reference=?',(REF1,)).fetchone()[0],'pending')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_checkout_reviews').fetchone()[0],0)

    def test_wrong_amount_poll_url_or_reference_cannot_launder_provider_event(self):
        for kw in [{'amount':426},{'poll':POLL2},{'reference':'STORE-0000000000000000'}]:
            with self.subTest(kw=kw),self.assertRaises(sqlite3.IntegrityError):
                self.observe(**kw)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],0)

    def test_unique_event_identity_no_update_delete_or_replace_even_on_default_sqlite(self):
        self.observe()
        for statement in [
            ("UPDATE store_paynow_status_observations SET provider_status='Paid' WHERE event_id='evt-001'",()),
            ("DELETE FROM store_paynow_status_observations WHERE event_id='evt-001'",()),
            ("INSERT OR REPLACE INTO store_paynow_status_observations SELECT * FROM store_paynow_status_observations WHERE event_id='evt-001'",()),
        ]:
            with self.subTest(statement=statement[0]), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(*statement)
        self.assertEqual(self.db.execute('SELECT provider_status FROM store_paynow_status_observations').fetchone()[0],'Cancelled')

    def test_provider_reference_cannot_claim_two_distinct_store_orders(self):
        self.observe()
        with self.assertRaises(sqlite3.IntegrityError):
            self.observe(event_id='evt-002',reference=REF2,poll=POLL2,provider_reference='PAYNOW-ABC-123',cb='c'*64,polled='d'*64)

    def test_existing_signed_review_provider_id_cannot_be_stolen_by_a_second_order(self):
        self.db.execute("INSERT INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES (?,'PAYNOW-ABC-123','review_required',?,?,'2026-10-27T21:00:00Z')",(REF1,D1,D2))
        self.db.execute("UPDATE store_checkout_intents SET status='review_required' WHERE reference=?",(REF1,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.observe(event_id='evt-002',reference=REF2,poll=POLL2)

    def test_observation_after_paid_review_must_not_alter_the_historical_review(self):
        self.db.execute("INSERT INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES (?,'PAYNOW-ABC-123','review_required',?,?,'2026-10-27T21:00:00Z')",(REF1,D1,D2))
        self.db.execute("UPDATE store_checkout_intents SET status='review_required' WHERE reference=?",(REF1,))
        self.observe(event_id='evt-post-review',status='Disputed',cb='c'*64,polled='d'*64)
        self.assertEqual(self.db.execute('SELECT status FROM store_checkout_intents WHERE reference=?',(REF1,)).fetchone()[0],'review_required')
        self.assertEqual(self.db.execute('SELECT review_status FROM store_checkout_reviews WHERE reference=?',(REF1,)).fetchone()[0],'review_required')
        self.assertEqual(self.db.execute('SELECT provider_status FROM store_paynow_status_observations WHERE event_id=?',('evt-post-review',)).fetchone()[0],'Disputed')

    def test_digest_replay_is_rejected_but_new_observation_can_be_appended(self):
        self.observe()
        with self.assertRaises(sqlite3.IntegrityError):
            self.observe(event_id='evt-002',cb=D1,polled=D2)
        self.observe(event_id='evt-003',status='Disputed',cb='c'*64,polled='d'*64)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],2)

    def test_observation_provider_identity_cannot_be_claimed_by_later_review_for_another_order(self):
        # The inverse order also matters: an immutable observation on order A
        # must bar a later signed-review row on order B from taking its Paynow ref.
        self.observe(event_id='evt-reverse-claim',reference=REF1,
                     provider_reference='PAYNOW-ABC-123',poll=POLL1)
        for verb in ('INSERT', 'INSERT OR REPLACE', 'INSERT OR IGNORE'):
            with self.subTest(verb=verb), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"{verb} INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES (?,'PAYNOW-ABC-123','review_required',?,?,'2026-10-27T21:00:00Z')",(REF2,'c'*64,'d'*64))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_checkout_reviews').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],1)

    def test_one_store_order_cannot_change_provider_reference_across_observations(self):
        self.observe(event_id='evt-original', provider_reference='PAYNOW-ABC-123')
        with self.assertRaises(sqlite3.IntegrityError):
            self.observe(event_id='evt-different', provider_reference='PAYNOW-OTHER-REF',
                         cb='c'*64, polled='d'*64, status='Disputed')
        self.assertEqual(self.db.execute(
            'SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0], 1)

    def test_review_cannot_rebind_same_store_order_to_different_provider_reference(self):
        self.observe(event_id='evt-original', provider_reference='PAYNOW-ABC-123')
        for verb in ('INSERT', 'INSERT OR REPLACE', 'INSERT OR IGNORE'):
            with self.subTest(verb=verb), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"{verb} INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES (?,'PAYNOW-OTHER-REF','review_required',?,?,'2026-10-27T21:00:00Z')",(REF1,'c'*64,'d'*64))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_checkout_reviews').fetchone()[0],0)

    def test_later_observation_cannot_rebind_existing_review_to_different_provider_reference(self):
        self.db.execute("INSERT INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES (?,'PAYNOW-ABC-123','review_required',?,?,'2026-10-27T21:00:00Z')",(REF1,D1,D2))
        self.db.execute("UPDATE store_checkout_intents SET status='review_required' WHERE reference=?",(REF1,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.observe(event_id='evt-conflict', provider_reference='PAYNOW-OTHER-REF',
                         cb='c'*64, polled='d'*64,status='Disputed')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],0)

    def test_paid_and_refunded_not_accepted_as_audit_only_observation(self):
        for value in ['Paid','Refunded','Unknown','']:
            with self.subTest(value=value),self.assertRaises(sqlite3.IntegrityError):
                self.observe(status=value)

    def test_bad_digest_and_wrong_currency_are_refused(self):
        with self.assertRaises(sqlite3.IntegrityError): self.observe(cb='0'*63+'Z')
        with self.assertRaises(sqlite3.IntegrityError): self.observe(polled='0'*63)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('''INSERT INTO store_paynow_status_observations(event_id,reference,paynow_reference,provider_status,amount_cents,currency,poll_url,callback_digest,poll_digest,observed_at) VALUES ('evt-wrong',?, 'PAYNOW-ABC-123','Sent',425,'ZWG', ?, ?,?,'2026-10-27T21:00:00Z')''',(REF1,POLL1,D1,D2))

if __name__=='__main__':
    unittest.main()
