"""Fail-closed data-import and research-only optimizer acceptance tests."""
import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from research_pipeline import ResearchError, parse_history, assess_freshness, walk_forward


def data(rows=80, rise=True):
    start=datetime(2026,10,25,0,0,tzinfo=timezone.utc)
    records=['timestamp_utc,open,high,low,close,tick_volume']
    for i in range(rows):
        v=Decimal('100')+Decimal(i if rise else rows-i)/Decimal('10')
        records.append(f'{(start+timedelta(minutes=i)).isoformat().replace("+00:00","Z")},{v},{v+1},{v-1},{v+Decimal("0.5")},100')
    return ('\n'.join(records)+'\n').encode()


class ResearchPipelineTests(unittest.TestCase):
    def load(self,rows=80):
        return parse_history(data(rows),symbol='EURUSD',timeframe='M1',claimed_source='owner_demo_export')

    def test_parse_user_csv_has_digest_and_unverified_provenance(self):
        raw=data()
        ds=parse_history(raw,'EURUSD','M1','owner_demo_export')
        self.assertEqual(ds['sha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(len(ds['bars']),80)
        self.assertFalse(ds['broker_verified'])
        self.assertFalse(ds['live_feed_verified'])
        self.assertEqual(ds['source_class'],'UNVERIFIED_OWNER_SUPPLIED_CSV')
        self.assertEqual(ds['bars'][0]['time'].tzinfo,timezone.utc)

    def test_reject_ohlc_violations_and_duplicates(self):
        bad=data().decode().replace(',101,99,100.5,100\n',',100,99,100.5,100\n')
        with self.assertRaises(ResearchError):parse_history(bad.encode(),'EURUSD','M1','demo')
        lines=data().splitlines()
        duplicate=b'\n'.join(lines[:3]+[lines[2]]+lines[3:])+b'\n'
        with self.assertRaises(ResearchError):parse_history(duplicate,'EURUSD','M1','demo')

    def test_reject_missing_columns_extra_columns_and_formula_injection(self):
        for bad in (b'timestamp_utc,open,high,low,close\n',
                    data().replace(b'tick_volume',b'tick_volume,evil'),
                    data().replace(b'100,101',b'=HYPERLINK,101')):
            with self.assertRaises(ResearchError):parse_history(bad,'EURUSD','M1','demo')
        with self.assertRaises(ResearchError):parse_history(data(),'=BAD','M1','demo')

    def test_reject_non_utc_invalid_price_and_nonfinite(self):
        for bad in (b'2026-10-25T00:00:00+01:00',b'2026-10-25T00:00:00',b'NaN',b'Infinity',b'-100.0'):
            raw=data().replace(b'2026-10-25T00:00:00Z',bad) if bad.startswith(b'2026') else data().replace(b'100,101',bad+b',101')
            with self.assertRaises(ResearchError):parse_history(raw,'EURUSD','M1','demo')

    def test_csv_size_row_bound(self):
        with self.assertRaises(ResearchError):parse_history(b'x'*(1024*1024+1),'EURUSD','M1','demo')
        with self.assertRaises(ResearchError):parse_history(data(5001),'EURUSD','M1','demo')

    def test_reject_data_changed_after_digest_assigned(self):
        ds=self.load()
        ds['bars'][0]['close']=Decimal('9000')
        with self.assertRaises(ResearchError):walk_forward(ds,[(3,8)])
        with self.assertRaises(ResearchError):assess_freshness(ds,ds['bars'][-1]['time'])

    def test_quote_snapshot_freshness_does_not_claim_broker_connection(self):
        ds=self.load()
        t=ds['bars'][-1]['time']
        self.assertFalse(assess_freshness(ds,t+timedelta(seconds=40),max_age_sec=30)['fresh'])
        good=assess_freshness(ds,t+timedelta(seconds=20),max_age_sec=30)
        self.assertTrue(good['fresh'])
        self.assertEqual(good['classification'],'RECENT_OWNER_IMPORTED_BAR_NOT_LIVE_QUOTE')
        self.assertFalse(good['live_feed_verified'])
        with self.assertRaises(ResearchError):assess_freshness(ds,t-timedelta(seconds=10))

    def test_walk_forward_is_bounded_reproducible_and_out_of_sample(self):
        ds=self.load()
        a=walk_forward(ds,[(3,8),(4,10)],fee_bps='2.00')
        b=walk_forward(ds,[(3,8),(4,10)],fee_bps='2.00')
        self.assertEqual(a,b)
        self.assertEqual(a['chosen_on'],'TRAIN_ONLY')
        self.assertEqual(a['out_of_sample_start'],60)
        self.assertEqual(a['out_of_sample_bars'],20)
        self.assertEqual(a['data_sha256'],ds['sha256'])
        self.assertFalse(a['mt5_tester_verified'])
        self.assertFalse(a['orders_enabled'])
        self.assertTrue(a['research_only'])

    def test_selection_does_not_peek_into_out_of_sample_bars(self):
        ds=self.load()
        changed=data().splitlines()
        for i in range(61,len(changed)):
            parts=changed[i].decode().split(',')
            if i==61: continue
            price=Decimal('120')+Decimal(i%3)
            parts[1:5]=[str(price),str(price+1),str(price-1),str(price)]
            changed[i]=(','.join(parts)).encode()
        other=parse_history(b'\n'.join(changed)+b'\n','EURUSD','M1','owner_demo_export')
        a=walk_forward(ds,[(3,8),(4,10)])
        b=walk_forward(other,[(3,8),(4,10)])
        self.assertEqual(a['selected_parameters'],b['selected_parameters'])

    def test_reject_unsafe_grid_and_cost_and_history_size(self):
        ds=self.load()
        for pairs in ([],[(2,2)],[(100,101)],[(1,4)],[(3,8)]*26,[(True,8)]):
            with self.subTest(pairs=pairs),self.assertRaises(ResearchError):walk_forward(ds,pairs)
        for fee in ('-1','Infinity','1e10','1001',2.5):
            with self.subTest(fee=fee),self.assertRaises(ResearchError):walk_forward(ds,[(3,8)],fee_bps=fee)
        with self.assertRaises(ResearchError):walk_forward(self.load(20),[(3,8)])


if __name__=='__main__': unittest.main()
