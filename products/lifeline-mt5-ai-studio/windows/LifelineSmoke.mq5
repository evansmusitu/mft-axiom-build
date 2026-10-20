#property strict
#property version   "1.00"
#property description "LIFELINE isolated native compiler and Strategy Tester smoke EA. NO TRADES."
input int InpProbeValue=7;
int OnInit(){ Print("LIFELINE_SMOKE_INIT:",InpProbeValue); return INIT_SUCCEEDED; }
void OnDeinit(const int reason){ Print("LIFELINE_SMOKE_STOP:",reason); }
double OnTester(){ return (double)InpProbeValue; }
void OnTick(){ /* intentionally no orders, positions or trade requests */ }
