package com.musitu.store;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Read-only Android discovery entries from a previously root-signed verified catalog. */
final class V2AndroidAppListing {
  static final class Entry {
    final String appId,publisherId,packageId;
    final long versionCode,bytes;
    private Entry(V2SignedAndroidCatalog.Release r){
      this.appId=r.appId;this.publisherId=r.publisherId;this.packageId=r.packageId;
      this.versionCode=r.versionCode;this.bytes=r.bytes;
    }
  }
  static List<Entry> from(V2SignedAndroidCatalog.Verified verified){
    if(verified==null)throw new SecurityException("missing trusted signed registry");
    List<Entry> result=new ArrayList<>();
    for(V2SignedAndroidCatalog.Release r:verified.androidReleases)result.add(new Entry(r));
    return Collections.unmodifiableList(result);
  }
  static V2SignedAndroidCatalog.Release select(V2SignedAndroidCatalog.Verified verified,String appId){
    if(verified==null||appId==null||appId.isEmpty())
      throw new SecurityException("verified catalog and application identity required");
    return verified.selectAndroid(appId);
  }
  private V2AndroidAppListing(){}
}
