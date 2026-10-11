package com.musitu.store;

import android.content.Context;
import android.graphics.Color;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.List;

/**
 * Preview-only multi-developer application browser.
 *
 * Accepts ONLY releases from a verified, root-signed v2 catalog. The controls
 * hand off the selected signed release to a caller for separate review and
 * standard Android installation approval; clicking a button never installs.
 *
 * This is NOT wired into the existing V1 production MainActivity.
 */
final class V2AndroidAppBrowser {
  interface SelectionListener {
    void onSelect(V2SignedAndroidCatalog.Release selected);
  }
  private static TextView text(Context ctx,String value,int sp,int color){
    TextView t=new TextView(ctx);
    t.setText(value);
    t.setTextSize(sp);
    t.setTextColor(color);
    t.setPadding(12,12,12,12);
    return t;
  }
  static View render(Context context,V2SignedAndroidCatalog.Verified verified,SelectionListener listener){
    if(context==null||verified==null||listener==null)
      throw new SecurityException("verified registry and selection handler are mandatory");
    List<V2AndroidAppListing.Entry> entries=V2AndroidAppListing.from(verified);
    ScrollView scroll=new ScrollView(context);
    LinearLayout list=new LinearLayout(context);
    list.setOrientation(LinearLayout.VERTICAL);
    list.setPadding(18,24,18,24);
    list.setBackgroundColor(Color.rgb(7,17,31));
    scroll.addView(list);
    list.addView(text(context,"MUSITU STORE · VERIFIED APPLICATIONS",21,Color.WHITE));
    list.addView(text(context,
      "Publisher identities and release metadata are taken from a signed catalog. "+
      "Android will ask you to approve installation separately.",14,0xffcad6e8));
    for(V2AndroidAppListing.Entry entry:entries){
      list.addView(text(context,entry.appId,19,Color.WHITE));
      list.addView(text(context,
        "Publisher: "+entry.publisherId+"\nPackage: "+entry.packageId+
        "\nVersion code: "+entry.versionCode+"\nDownload size: "+entry.bytes+" bytes",
        14,0xffc3d0e1));
      Button button=new Button(context);
      button.setText("Review installation");
      button.setTag("review:"+entry.appId);
      button.setContentDescription("Review installation of "+entry.appId+
        " from publisher "+entry.publisherId);
      button.setOnClickListener(v->listener.onSelect(
        V2AndroidAppListing.select(verified,entry.appId)));
      list.addView(button);
    }
    return scroll;
  }
  private V2AndroidAppBrowser(){}
}
