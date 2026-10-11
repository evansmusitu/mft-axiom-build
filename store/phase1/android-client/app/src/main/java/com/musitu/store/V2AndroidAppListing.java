package com.musitu.store;
import java.util.List;
/** Verified-only app discovery model for the future Android marketplace. */
final class V2AndroidAppListing {
  static final class Entry {
    final String appId,publisherId,packageId;
    final long versionCode,bytes;
    Entry(String appId,String publisherId,String packageId,long versionCode,long bytes){
      this.appId=appId;this.publisherId=publisherId;this.packageId=packageId;
      this.versionCode=versionCode;this.bytes=bytes;
    }
  }
  static List<Entry> from(V2SignedAndroidCatalog.Verified verified){
    throw new UnsupportedOperationException("multi-publisher listing not implemented");
  }
  static V2SignedAndroidCatalog.Release select(V2SignedAndroidCatalog.Verified verified,String appId){
    throw new UnsupportedOperationException("release selection not implemented");
  }
  private V2AndroidAppListing(){}
}
