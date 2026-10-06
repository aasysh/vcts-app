package np.kamana.vcts;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;

public class MainActivity extends Activity {

    WebView ui;
    WebView site;
    LinearLayout siteBox;
    TextView siteStatus;
    Store store;
    Runner runner;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(false);
        store = new Store(this);

        FrameLayout root = new FrameLayout(this);

        siteBox = new LinearLayout(this);
        siteBox.setOrientation(LinearLayout.VERTICAL);
        siteBox.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(0xFF0F4C81);
        bar.setPadding(dp(14), dp(6), dp(6), dp(6));
        siteStatus = new TextView(this);
        siteStatus.setTextColor(Color.WHITE);
        siteStatus.setTypeface(Typeface.DEFAULT_BOLD);
        siteStatus.setText("VCTS");
        siteStatus.setMaxLines(2);
        Button back = new Button(this);
        back.setText("← App");
        back.setAllCaps(false);
        back.setOnClickListener(v -> showSite(false));
        bar.addView(siteStatus, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(back, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        site = new WebView(this);
        siteBox.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        siteBox.addView(site, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        ui = new WebView(this);
        ui.setBackgroundColor(Color.WHITE);

        // The VCTS page sits underneath the app screen so it always has a real size;
        // "showing" it just hides the app screen on top.
        root.addView(siteBox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(ui, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        runner = new Runner(this, site, store);
        setupSite();
        setupUi();
        ui.loadUrl("file:///android_asset/ui/index.html");
    }

    int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void setupSite() {
        WebSettings s = site.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(site, false);
        site.addJavascriptInterface(runner.bridge, "Bot");
        site.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                return host == null || !host.endsWith("dri.gov.np");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                runner.onPageFinished(url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) runner.onMainFrameError(String.valueOf(error.getDescription()));
            }
        });
        site.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                if (!runner.isRunning()) return false;
                runner.note(message);
                result.confirm();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (!runner.isRunning()) return false;
                runner.note(message);
                result.cancel();
                return true;
            }
        });
    }

    private void setupUi() {
        WebSettings s = ui.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        ui.addJavascriptInterface(new UiBridge(), "App");
        ui.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith("file:///android_asset/");
            }
        });
        ui.setWebChromeClient(new WebChromeClient());
    }

    /** Sends an event object to the app screen (window.onEvent). */
    void emit(JSONObject event) {
        final String js = "window.onEvent && window.onEvent(" + event.toString() + ")";
        runOnUiThread(() -> ui.evaluateJavascript(js, null));
    }

    void setSiteStatus(String text) {
        runOnUiThread(() -> siteStatus.setText(text));
    }

    void showSite(boolean show) {
        ui.setVisibility(show ? View.INVISIBLE : View.VISIBLE);
    }

    boolean siteShown() {
        return ui.getVisibility() != View.VISIBLE;
    }

    void openPdf(String path) {
        File f = new File(path);
        if (!f.exists()) {
            Toast.makeText(this, "PDF भेटिएन", Toast.LENGTH_SHORT).show();
            return;
        }
        Uri uri = PdfProvider.uriFor(this, f);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/pdf");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(i, "PDF खोल्नुहोस्"));
        } catch (Exception e) {
            Toast.makeText(this, "PDF खोल्ने app छैन", Toast.LENGTH_LONG).show();
        }
    }

    void sharePdf(String path, String text) {
        File f = new File(path);
        if (!f.exists()) {
            Toast.makeText(this, "PDF भेटिएन", Toast.LENGTH_SHORT).show();
            return;
        }
        Uri uri = PdfProvider.uriFor(this, f);
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("application/pdf");
        i.putExtra(Intent.EXTRA_STREAM, uri);
        if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
        i.setClipData(ClipData.newRawUri(f.getName(), uri));
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(i, "Share"));
    }

    /** Fallback when the PDF cannot be saved directly: the phone's own print screen ("Save as PDF"). */
    void systemPrint(String name) {
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        if (pm == null) return;
        PrintAttributes attrs = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .build();
        pm.print(name, site.createPrintDocumentAdapter(name), attrs);
    }

    @Override
    public void onBackPressed() {
        if (siteShown()) {
            showSite(false);
            return;
        }
        ui.evaluateJavascript("(window.onBack ? window.onBack() : false)", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    /** Methods the app screen can call (window.App). */
    class UiBridge {
        @JavascriptInterface
        public String get(String key) {
            return store.get(key);
        }

        @JavascriptInterface
        public void put(String key, String value) {
            store.put(key, value);
        }

        @JavascriptInterface
        public void setPassword(String pw) {
            store.setPassword(pw);
        }

        @JavascriptInterface
        public boolean hasPassword() {
            return store.hasPassword();
        }

        @JavascriptInterface
        public void run(String jobJson, boolean dry) {
            runner.runJob(jobJson, dry);
        }

        @JavascriptInterface
        public void sync(String json) {
            runner.sync(json);
        }

        @JavascriptInterface
        public void reprint(String consignmentId) {
            runner.reprint(consignmentId);
        }

        @JavascriptInterface
        public void stop() {
            runner.stop();
        }

        @JavascriptInterface
        public void showSite(boolean show) {
            runOnUiThread(() -> MainActivity.this.showSite(show));
        }

        @JavascriptInterface
        public void openPdf(String path) {
            runOnUiThread(() -> MainActivity.this.openPdf(path));
        }

        @JavascriptInterface
        public void sharePdf(String path, String text) {
            runOnUiThread(() -> MainActivity.this.sharePdf(path, text));
        }

        @JavascriptInterface
        public boolean pdfExists(String path) {
            return path != null && !path.isEmpty() && new File(path).exists();
        }
    }
}
