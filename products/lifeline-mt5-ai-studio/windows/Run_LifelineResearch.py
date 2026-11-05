"""Strictly offline owner history research CLI: no broker connection or orders."""
import argparse
import json
from pathlib import Path
import sys
from research_pipeline import parse_history, walk_forward, assess_freshness, ResearchError, MAX_BYTES


def main(argv=None):
    p=argparse.ArgumentParser(description='Offline imported CSV analysis; NOT MT5 backtest or live feed')
    p.add_argument('--csv',required=True)
    p.add_argument('--symbol',required=True)
    p.add_argument('--timeframe',required=True)
    p.add_argument('--claimed-source',required=True)
    p.add_argument('--fast',type=int,default=3)
    p.add_argument('--slow',type=int,default=8)
    p.add_argument('--fee-bps',default='2.00')
    a=p.parse_args(argv)
    try:
        f=Path(a.csv)
        if not f.is_file() or f.stat().st_size>MAX_BYTES or f.is_symlink():
            raise ResearchError('invalid source file')
        raw=f.read_bytes()
        dataset=parse_history(raw,a.symbol,a.timeframe,a.claimed_source)
        result=walk_forward(dataset,[(a.fast,a.slow)],fee_bps=a.fee_bps)
        evidence={'schema':'lifeline.local_owner_research.v1',
                  'imported_bars':len(dataset['bars']),
                  'first_utc':dataset['bars'][0]['time'].isoformat(),
                  'last_utc':dataset['bars'][-1]['time'].isoformat(),
                  'symbol':dataset['symbol'],'timeframe':dataset['timeframe'],
                  'data_sha256':dataset['sha256'],
                  'broker_verified':False, 'connected_to_mt5':False,
                  'market_data_live':False,'trading_enabled':False,
                  'analysis':result}
        print(json.dumps(evidence,sort_keys=True))
        return 0
    except (ResearchError,OSError,ValueError) as exc:
        print(json.dumps({'schema':'lifeline.research.error.v1','status':'REJECTED',
                          'reason':type(exc).__name__,'trading_enabled':False}),file=sys.stderr)
        return 2

if __name__=='__main__':
    sys.exit(main())
