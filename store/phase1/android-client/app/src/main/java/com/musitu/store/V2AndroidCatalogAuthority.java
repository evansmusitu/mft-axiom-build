package com.musitu.store;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Collections;

/**
 * Isolated policy boundary for future production V2 catalog acceptance.
 *
 * A publisher/request cannot inject its own signing root or artifact host list.
 * The root is the existing MUSITU Store v1 pinned public key, not a newly
 * generated or unsigned remote key. State is synchronous and process-serialized.
 *
 * NOTE: Caller must provide a trusted time source; secure clock acquisition,
 * revocation, cross-install continuity and live integration remain unqualified.
 */
final class V2AndroidCatalogAuthority {
  static final String ROOT_FINGERPRINT="4cf17f70dbab900237d8b82b4e989978c667e6ec841de6df79469aa6c5ebd5c0";
  static final String PREFS="musitu_store_v2_catalog_watermark";
  private static final String REV="revision", DIGEST="digest",INITIALIZED="initialized";

  static synchronized V2SignedAndroidCatalog.Verified acceptAndCommit(
      Context context,byte[] catalog,byte[] signature,long trustedNowMillis)throws Exception {
    if(context==null||trustedNowMillis<=0)throw new SecurityException("trusted context and time required");
    SharedPreferences prefs=context.getApplicationContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE);
    long revision=0;
    String previousDigest=null;
    if(prefs.getBoolean(INITIALIZED,false)){
      revision=prefs.getLong(REV,-1);
      previousDigest=prefs.getString(DIGEST,null);
      if(revision<1||previousDigest==null||!previousDigest.matches("[0-9a-f]{64}"))
        throw new SecurityException("corrupt trusted catalog watermark");
    }
    V2SignedAndroidCatalog.Verified verified=V2SignedAndroidCatalog.verify(
      catalog,signature,StoreCore.PUB_PEM,ROOT_FINGERPRINT,
      revision,previousDigest,
      Collections.singletonList("payments.mftintelligence.com"),trustedNowMillis);
    if(!prefs.edit().putLong(REV,verified.revision)
        .putString(DIGEST,verified.digest).putBoolean(INITIALIZED,true).commit())
      throw new SecurityException("failed to persist trusted catalog watermark");
    return verified;
  }
  private V2AndroidCatalogAuthority(){}
}
