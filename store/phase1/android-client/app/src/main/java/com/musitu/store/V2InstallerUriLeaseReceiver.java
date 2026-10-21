package com.musitu.store;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import androidx.core.content.FileProvider;
import java.io.File;

/**
 * Private best-effort expiry for a verified APK's installer-only read grant.
 * Explicit cancellation/completion must still revoke immediately; system
 * alarms can be deferred or suppressed by force-stop and are not an OS receipt.
 */
public final class V2InstallerUriLeaseReceiver extends BroadcastReceiver {
  private static final String EXTRA_APK="com.musitu.store.extra.LEASE_APK";
  private static final int READ=Intent.FLAG_GRANT_READ_URI_PERMISSION;

  private static PendingIntent token(Context c,File apk,int flags){
    Intent intent=new Intent(c,V2InstallerUriLeaseReceiver.class);
    // Android PendingIntent identity ignores extras; uniquely identify each APK.
    intent.setData(Uri.parse("musitustore://installer-grant/"+apk.getName()));
    intent.putExtra(EXTRA_APK,apk.getAbsolutePath());
    return PendingIntent.getBroadcast(c,0,intent,flags|PendingIntent.FLAG_IMMUTABLE);
  }
  /** Arm before granting; failure must abort installation without leaking URI. */
  static void arm(Context c,File apk)throws Exception{
    apk=V2InstallerUriLeasePolicy.checkedApk(c.getFilesDir(),apk);
    AlarmManager alarm=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
    if(alarm==null)throw new SecurityException("URI grant expiry alarm unavailable");
    long expiry=V2InstallerUriLeasePolicy.expirationAtElapsedRealtime(SystemClock.elapsedRealtime());
    PendingIntent pi=token(c,apk,PendingIntent.FLAG_UPDATE_CURRENT);
    try{alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,expiry,pi);}
    catch(RuntimeException failed){pi.cancel();throw failed;}
  }
  static boolean isArmed(Context c,File apk)throws Exception{
    apk=V2InstallerUriLeasePolicy.checkedLeasePath(c.getFilesDir(),apk);
    return token(c,apk,PendingIntent.FLAG_NO_CREATE)!=null;
  }
  /** Cancel alarm after permission has been revoked by the normal caller. */
  static void disarm(Context c,File apk)throws Exception{
    apk=V2InstallerUriLeasePolicy.checkedLeasePath(c.getFilesDir(),apk);
    PendingIntent pi=token(c,apk,PendingIntent.FLAG_NO_CREATE);
    if(pi==null)return;
    AlarmManager alarm=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
    if(alarm!=null)alarm.cancel(pi);
    pi.cancel();
  }
  @Override public void onReceive(Context context,Intent intent){
    if(intent==null||!V2InstallerUriLeaseReceiver.class.getName().equals(intent.getComponent()==null?"":intent.getComponent().getClassName()))return;
    String name=intent.getData()==null?null:intent.getData().getLastPathSegment();
    String raw=intent.getStringExtra(EXTRA_APK);
    if(name==null||raw==null)return;
    try{
      File apk=V2InstallerUriLeasePolicy.checkedLeasePath(context.getFilesDir(),new File(raw));
      if(!name.equals(apk.getName()))return;
      Uri uri=FileProvider.getUriForFile(context,"com.musitu.store.files",apk);
      context.revokeUriPermission(uri,READ);
      disarm(context,apk);
    }catch(Exception ignored){
      // Fail closed: the receiver never opens/reads arbitrary paths or grants access.
    }
  }
}
