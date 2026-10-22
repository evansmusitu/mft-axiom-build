package com.musitu.store.v2acceptance;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.graphics.Color;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Private offline probe. NEVER presents itself as the signed production Store or a Store V2 installer. */
public final class DeviceAcceptanceActivity extends Activity {
    private TextView receiptText;
    private String receipt = "UNAVAILABLE";
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        final LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(30, 45, 30, 45);
        layout.setBackgroundColor(Color.rgb(11, 20, 39));
        layout.addView(label("MUSITU V2 — DEVICE TEST ONLY", 24, Color.WHITE));
        layout.addView(label("This offline app is NOT MUSITU Store V2. It cannot install apps, access payments, enroll publishers or verify real Store functionality.", 16, 0xfff2bd7c));
        layout.addView(label("If you can read this on your own Android device, the isolated test app was installed and launched. Copy the receipt only if you choose to share the non-unique device model and Android version.", 15, 0xffcedbf3));
        receiptText = label("Loading device-only acceptance receipt…", 14, Color.WHITE);
        layout.addView(receiptText);
        Button refresh = new Button(this);
        refresh.setText("Refresh device receipt");
        refresh.setOnClickListener(v -> refreshReceipt());
        layout.addView(refresh);
        Button copy = new Button(this);
        copy.setText("Copy receipt (manual, offline)");
        copy.setOnClickListener(v -> {
            ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            manager.setPrimaryClip(ClipData.newPlainText("MUSITU isolated Android device receipt", receipt));
            Toast.makeText(this, "Copied locally. Paste it in ChatGPT if you consent.", Toast.LENGTH_LONG).show();
        });
        layout.addView(copy);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(layout);
        setContentView(scroll);
        refreshReceipt();
    }
    private TextView label(String value, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setPadding(0, 10, 0, 16);
        t.setTextIsSelectable(true);
        return t;
    }
    private static String sha256(byte[] bytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest(bytes)) hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return hex.toString();
    }
    private void refreshReceipt() {
        try {
            PackageManager pm = getPackageManager();
            final PackageInfo info;
            final Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28) {
                info = pm.getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                sigs = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
            } else {
                info = pm.getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES);
                sigs = info.signatures;
            }
            if (sigs == null || sigs.length != 1) throw new IllegalStateException("Missing or ambiguous Android signer");
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            receipt =
                "schema=musitu.store.v2.android-device-witness.v1\n" +
                "scope=ISOLATED_OFFLINE_PROBE_NOT_REAL_STORE_V2\n" +
                "appInstalledAndLaunched=true\n" +
                "packageId=" + info.packageName + "\n" +
                "versionName=" + info.versionName + "\n" +
                "androidSdk=" + Build.VERSION.SDK_INT + "\n" +
                "manufacturer=" + Build.MANUFACTURER + "\n" +
                "model=" + Build.MODEL + "\n" +
                "signerCertificateSha256=" + sha256(sigs[0].toByteArray()) + "\n" +
                "observedAtUtc=" + format.format(new Date()) + "\n" +
                "networkPermissionRequired=false\n" +
                "actualV2InstallerCertified=false\n" +
                "paymentOrPublisherApproval=false\n";
        } catch (Exception ex) {
            receipt = "DEVICE_RECEIPT_FAIL_CLOSED: " + ex.getClass().getSimpleName();
        }
        receiptText.setText(receipt);
    }
}
