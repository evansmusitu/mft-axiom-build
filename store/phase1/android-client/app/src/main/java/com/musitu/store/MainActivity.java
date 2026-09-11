package com.musitu.store;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.File;
import java.util.Locale;
import java.util.concurrent.*;

public class MainActivity extends Activity {
  final ExecutorService io=Executors.newSingleThreadExecutor(); LinearLayout root; TextView status,meta; Button primary,repair,rollback,transfer,refresh; JSONObject catalog,release; String pendingAction;
  @Override public void onCreate(Bundle b){super.onCreate(b);renderShell();if(b==null)acceptInstallIntent(getIntent());scheduleUpdates();refresh();}
  @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(acceptInstallIntent(intent)){if(release!=null)maybeRunPendingAction();else refresh();}}
  @Override protected void onResume(){super.onResume();try{if(StoreCore.resumePendingInstall(this)&&status!=null)status.setText("Verified package ready. Android is asking you to approve installation.");}catch(Exception e){if(status!=null)status.setText("Pending installation stopped: "+e.getMessage());}}
  boolean acceptInstallIntent(Intent intent){
    if(intent==null||!Intent.ACTION_VIEW.equals(intent.getAction()))return false;Uri u=intent.getData();if(u==null)return false;
    if(!"musitustore".equalsIgnoreCase(u.getScheme())||!"app".equalsIgnoreCase(u.getHost())||!"/chemistry".equals(u.getPath()))return false;
    String action=u.getQueryParameter("action");if(action==null||action.trim().isEmpty())action="install";action=action.toLowerCase(Locale.ROOT);
    if(!("install".equals(action)||"update".equals(action)||"repair".equals(action)||"reinstall".equals(action)))return false;
    pendingAction=action;intent.setData(null);return true;
  }
  void maybeRunPendingAction(){
    if(release==null||pendingAction==null)return;String action=pendingAction;pendingAction=null;status.setText("Continuing requested "+action+" in MUSITU Store…");
    if("repair".equals(action)||"reinstall".equals(action))downloadAndInstall();else primaryAction();
  }
  void renderShell(){
    ScrollView sv=new ScrollView(this);root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(42,56,42,56);root.setBackgroundColor(Color.rgb(7,17,31));sv.addView(root);
    TextView brand=text("MUSITU STORE",14,0xff91a8ff);root.addView(brand);root.addView(text("MUSITU Chemistry",30,Color.WHITE));root.addView(text("Verified education app · offline-first · Scientific Response",16,0xffc7d2e6));
    status=text("Checking signed catalog…",16,0xffdce6f7);status.setPadding(0,28,0,20);root.addView(status);meta=text("",14,0xffaebdd4);root.addView(meta);
    primary=button("Checking…");repair=button("Repair / Reinstall");rollback=button("Roll Back");transfer=button("Transfer Device");refresh=button("Check for updates");
    root.addView(primary);root.addView(repair);root.addView(rollback);root.addView(transfer);root.addView(refresh);setContentView(sv);
    primary.setOnClickListener(v->primaryAction());repair.setOnClickListener(v->downloadAndInstall());rollback.setOnClickListener(v->Toast.makeText(this,"No older native release is currently authorized. 1.2.0 remains retired.",Toast.LENGTH_LONG).show());
    transfer.setOnClickListener(v->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://payments.mftintelligence.com/store/apps/chemistry#transfer"))));refresh.setOnClickListener(v->refresh());
  }
  TextView text(String s,int sp,int color){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(color);t.setPadding(0,8,0,8);return t;}
  Button button(String s){Button b=new Button(this);b.setText(s);b.setAllCaps(false);b.setMinHeight(58);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,10,0,4);b.setLayoutParams(p);return b;}
  void refresh(){status.setText("Verifying signed MUSITU catalog…");refresh.setEnabled(false);io.execute(()->{try{JSONObject resolved;try{resolved=StoreCore.fetchVerified(this);}catch(Exception online){resolved=StoreCore.cachedVerified(this);}final JSONObject c=resolved;final JSONObject r=StoreCore.chemistry(c);runOnUiThread(()->apply(c,r));}catch(Exception e){runOnUiThread(()->{status.setText("Store verification failed. No unverified release will be installed.");primary.setEnabled(false);repair.setEnabled(false);refresh.setEnabled(true);});}});}
  void apply(JSONObject c,JSONObject r){catalog=c;release=r;refresh.setEnabled(true);long installed=StoreCore.installedVersion(this);long current=r.optLong("versionCode",-1);JSONObject a=r.optJSONObject("android");status.setText(installed<0?"Not installed":installed<current?"Update available":"Installed · up to date");
    meta.setText("Version "+r.optString("version")+" · "+(a==null?"":a.optLong("bytes")/1024/1024+" MB")+"\nVerified publisher: MUSITU\nChannel: stable · rollout: 100%\nPremium access remains controlled by MUSITU entitlement, not installation.");
    primary.setEnabled(true);repair.setEnabled(true);rollback.setEnabled(r.optJSONObject("rollback")!=null&&r.optJSONObject("rollback").optBoolean("authorized",false));primary.setText(installed<0?"Install":installed<current?"Update":"Open");maybeRunPendingAction();
  }
  void primaryAction(){long installed=StoreCore.installedVersion(this);long current=release==null?-1:release.optLong("versionCode",-1);if(installed>=current&&installed>0)StoreCore.openApp(this);else downloadAndInstall();}
  void downloadAndInstall(){if(release==null)return;JSONObject a=release.optJSONObject("android");if(a==null)return;primary.setEnabled(false);repair.setEnabled(false);status.setText("Preparing verified download…");io.execute(()->{try{final long expectedBytes=a.getLong("bytes");final String expectedSha=a.getString("sha256");File f=StoreCore.download(this,a.getString("apkURL"),expectedBytes,expectedSha,(d,t)->runOnUiThread(()->status.setText("Downloading securely… "+Math.min(100,(int)(100*d/Math.max(1,t)))+"%")));runOnUiThread(()->{try{primary.setEnabled(true);repair.setEnabled(true);boolean launched=StoreCore.install(this,f,expectedBytes,expectedSha);status.setText(launched?"Verified. Android is asking you to approve installation.":"Verified. Allow MUSITU Store to install apps, then return here; installation will continue automatically.");}catch(Exception e){status.setText("Installation stopped: "+e.getMessage());}});}catch(Exception e){runOnUiThread(()->{status.setText("Installation stopped: "+e.getMessage());primary.setEnabled(true);repair.setEnabled(true);});}});}
  void scheduleUpdates(){AlarmManager a=(AlarmManager)getSystemService(ALARM_SERVICE);Intent i=new Intent(this,UpdateCheckReceiver.class);PendingIntent p=PendingIntent.getBroadcast(this,101,i,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);a.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP,SystemClock.elapsedRealtime()+6*60*60*1000L,12*60*60*1000L,p);}
}
