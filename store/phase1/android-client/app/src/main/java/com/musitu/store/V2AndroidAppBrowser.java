package com.musitu.store;
import android.content.Context;
import android.view.View;
/** Preview-only multi-app view, backed only by validated signed catalog objects. */
final class V2AndroidAppBrowser {
  interface SelectionListener {
    void onSelect(V2SignedAndroidCatalog.Release selected);
  }
  static View render(Context context,V2SignedAndroidCatalog.Verified verified,SelectionListener listener){
    throw new UnsupportedOperationException("multi-app browser not implemented");
  }
  private V2AndroidAppBrowser(){}
}
