"""Bounded, local, research-only owner CSV import and walk-forward analysis.

NOT an MT5 Strategy Tester, live quote subscriber, broker authentication,
strategy profitability certificate, trading signal service or order executor.
Requires manually supplied owner export bytes; preserves unverified provenance.
No network, filesystem, subprocess, account or terminal access.
"""
from __future__ import annotations
import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import io
import re

MAX_BYTES=1024*1024
MAX_BARS=5000
MAX_CANDIDATES=25
FIELDS=('timestamp_utc','open','high','low','close','tick_volume')
SYMBOL=re.compile(r'^[A-Za-z0-9_.-]{1,30}$')
LABEL=re.compile(r'^[A-Za-z0-9_.-]{1,48}$')
NUMBER=re.compile(r'^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,8})?$')
DATE=re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
PERIODS={'M1','M5','M15','M30','H1','H4','D1'}

class ResearchError(ValueError):
    pass


def _price(raw: str) -> Decimal:
    if not isinstance(raw,str) or not NUMBER.fullmatch(raw):
        raise ResearchError('invalid finite price')
    try:
        value=Decimal(raw)
    except InvalidOperation as exc:
        raise ResearchError('invalid decimal') from exc
    if value<=0:
        raise ResearchError('nonpositive price')
    return value


def parse_history(csv_bytes: bytes, symbol: str, timeframe: str, claimed_source: str) -> dict:
    """Parse strict UTC OHLC bars; hashes prove input identity, NOT broker origin."""
    if type(csv_bytes) is not bytes or not 1<=len(csv_bytes)<=MAX_BYTES or b'\x00' in csv_bytes:
        raise ResearchError('invalid input size or encoding')
    if not isinstance(symbol,str) or not SYMBOL.fullmatch(symbol) or timeframe not in PERIODS:
        raise ResearchError('invalid symbol or timeframe')
    if not isinstance(claimed_source,str) or not LABEL.fullmatch(claimed_source):
        raise ResearchError('unsafe provenance label')
    try:
        text=csv_bytes.decode('utf-8','strict')
    except UnicodeDecodeError as exc:
        raise ResearchError('invalid UTF-8') from exc
    bars=[]
    reader=csv.reader(io.StringIO(text, newline=''),strict=True)
    try:
        header=next(reader,None)
        if header!=list(FIELDS):
            raise ResearchError('wrong CSV header')
        previous=None
        for row in reader:
            if len(row)!=len(FIELDS) or len(bars)>=MAX_BARS:
                raise ResearchError('invalid CSV row or bar limit')
            if not DATE.fullmatch(row[0]):
                raise ResearchError('timestamps must be UTC Z without offsets')
            try:
                instant=datetime.strptime(row[0],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
            except ValueError as exc:
                raise ResearchError('invalid UTC timestamp') from exc
            if previous and instant<=previous:
                raise ResearchError('duplicate or nonascending timestamp')
            previous=instant
            o,h,l,c=(_price(p) for p in row[1:5])
            if h < max(o,c,l) or l > min(o,c) or l > h:
                raise ResearchError('inconsistent OHLC candle')
            if not re.fullmatch(r'(?:0|[1-9][0-9]{0,11})',row[5]):
                raise ResearchError('invalid tick volume')
            bars.append({'time':instant,'open':o,'high':h,'low':l,'close':c,'tick_volume':int(row[5])})
    except csv.Error as exc:
        raise ResearchError('malformed CSV') from exc
    if len(bars)<1:
        raise ResearchError('missing bars')
    dataset={'schema':'lifeline.owner_csv.v1','symbol':symbol,'timeframe':timeframe,
            'claimed_source':claimed_source,'sha256':hashlib.sha256(csv_bytes).hexdigest(),
            'source_class':'UNVERIFIED_OWNER_SUPPLIED_CSV','broker_verified':False,
            'live_feed_verified':False,'bars':bars}
    dataset['parsed_sha256']=_bars_digest(dataset)
    return dataset


def _bars_digest(dataset: dict) -> str:
    try:
        normalized='\n'.join(
            '|'.join([b['time'].isoformat(),str(b['open']),str(b['high']),
                      str(b['low']),str(b['close']),str(b['tick_volume'])])
            for b in dataset['bars'])
    except (KeyError,TypeError,AttributeError) as exc:
        raise ResearchError('invalid parsed bar evidence') from exc
    return hashlib.sha256(normalized.encode('ascii')).hexdigest()


def _check_dataset(dataset: dict) -> None:
    if not isinstance(dataset,dict) or dataset.get('schema')!='lifeline.owner_csv.v1' \
            or dataset.get('broker_verified') is not False or not dataset.get('bars'):
        raise ResearchError('unqualified dataset')
    if dataset.get('parsed_sha256') != _bars_digest(dataset):
        raise ResearchError('parsed market data changed after import')


def assess_freshness(dataset: dict, now: datetime | None=None, max_age_sec: int=90) -> dict:
    """Report whether last *owner-imported bar timestamp* is recent, NOT live."""
    _check_dataset(dataset)
    if type(max_age_sec) is not int or not 1<=max_age_sec<=3600:
        raise ResearchError('invalid staleness policy')
    if now is None:
        now=datetime.now(timezone.utc)
    if not isinstance(now,datetime) or now.tzinfo is None:
        raise ResearchError('UTC now required')
    age=(now.astimezone(timezone.utc)-dataset['bars'][-1]['time']).total_seconds()
    if age<0:
        raise ResearchError('snapshot timestamp in future')
    return {'classification':'RECENT_OWNER_IMPORTED_BAR_NOT_LIVE_QUOTE',
            'age_seconds':int(age),'fresh':age<=max_age_sec,
            'bar_timestamp_utc':dataset['bars'][-1]['time'].isoformat(),
            'data_sha256':dataset['sha256'], 'live_feed_verified':False,
            'broker_verified':False,'trading_enabled':False}


def _window_return(bars: list, fast: int, slow: int, start: int, stop: int, cost: Decimal):
    equity=Decimal(1)
    peak=Decimal(1)
    worst=Decimal(0)
    count=0
    # All signals use only *previous* closes; no bar closes or future returns
    # can participate in the decision to enter at the current opening.
    for i in range(max(start,slow),stop):
        history=bars[i-slow:i]
        short=sum((b['close'] for b in history[-fast:]),Decimal(0))/fast
        long=sum((b['close'] for b in history),Decimal(0))/slow
        if short>long:
            count+=1
            gross=bars[i]['close']/bars[i]['open']-1
            equity*=1+gross-(cost*2/Decimal(10000))
        peak=max(equity,peak)
        worst=max(worst,(peak-equity)/peak)
    return equity-1,worst,count


def walk_forward(dataset: dict, candidates: list[tuple[int,int]], fee_bps: str='0.00') -> dict:
    """Finite deterministic intrabar SMA toy study; NOT native broker backtest."""
    _check_dataset(dataset)
    bars=dataset.get('bars')
    if not isinstance(bars,list) or not 40<=len(bars)<=MAX_BARS:
        raise ResearchError('need at least 40 imported bars')
    if type(candidates) is not list or not 1<=len(candidates)<=MAX_CANDIDATES:
        raise ResearchError('invalid parameter grid')
    if not isinstance(fee_bps,str) or not re.fullmatch(r'(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,2})?',fee_bps):
        raise ResearchError('invalid fee in bps')
    fee=Decimal(fee_bps)
    if fee>Decimal(1000):
        raise ResearchError('excessive fee')
    pairs=[]
    for candidate in candidates:
        if (type(candidate) is not tuple or len(candidate)!=2 or
            any(type(v) is not int for v in candidate)):
            raise ResearchError('invalid strategy pair')
        fast,slow=candidate
        if not 2<=fast<slow<=100 or candidate in pairs:
            raise ResearchError('invalid or repeated window pair')
        pairs.append(candidate)
    cut=len(bars)*3//4
    if cut<=max(slow for _,slow in pairs)+5 or len(bars)-cut<10:
        raise ResearchError('insufficient independent evaluation bars')
    with localcontext() as ctx:
        ctx.prec=28
        scored=[]
        for fast,slow in pairs:
            returned,drawdown,events=_window_return(bars,fast,slow,slow,cut,fee)
            scored.append((returned,-drawdown,-fast,-slow,events,fast,slow))
        chosen=max(scored)
        _,_,_,_,train_events,fast,slow=chosen
        train_gain,train_dd,_=_window_return(bars,fast,slow,slow,cut,fee)
        out_gain,out_dd,out_events=_window_return(bars,fast,slow,cut,len(bars),fee)
        fmt=lambda value:format((value*100).quantize(Decimal('0.000001')),'f')
        return {'schema':'lifeline.local_walkforward.v1',
                'selected_parameters':{'fast':fast,'slow':slow},
                'chosen_on':'TRAIN_ONLY','train_bars':cut,'out_of_sample_start':cut,
                'out_of_sample_bars':len(bars)-cut,'train_events':train_events,
                'out_of_sample_events':out_events,
                'train_return_percent':fmt(train_gain),'out_of_sample_return_percent':fmt(out_gain),
                'out_of_sample_max_drawdown_percent':fmt(out_dd),
                'roundtrip_cost_bps':str(fee), 'data_sha256':dataset['sha256'],
                'broker_verified':False,'mt5_tester_verified':False,
                'live_feed_verified':False,'orders_enabled':False,
                'research_only':True,
                'warning':'SYNTHETIC RULE EVALUATION OF UNVERIFIED OWNER CSV; NOT AN MT5 STRATEGY TESTER RESULT OR TRADING ADVICE'}
