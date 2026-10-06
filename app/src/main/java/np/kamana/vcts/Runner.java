package np.kamana.vcts;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PdfSaver;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Drives the VCTS website step by step in a WebView, the same way a person would:
 * log in, fill Add Consignment, save each bill, lock, start vehicle, save the print page as PDF.
 */
final class Runner {

    static final String BASE = "https://vctsdri.dri.gov.np";

    final MainActivity act;
    final WebView site;
    final Store store;
    final Handler main = new Handler(Looper.getMainLooper());
    final ExecutorService exec = Executors.newSingleThreadExecutor();
    final Bridge bridge = new Bridge();
    final ConcurrentHashMap<String, ArrayBlockingQueue<String>> pending = new ConcurrentHashMap<>();
    final AtomicInteger seq = new AtomicInteger();

    private final Object loadLock = new Object();
    private int loadCount = 0;
    private volatile String lastLoadError = null;

    private volatile boolean running = false;
    private volatile boolean stopRequested = false;
    private volatile String mode = "";
    private volatile String stage = "";
    private volatile String consignmentId = "";
    private final String botJs;

    static final class StopException extends Exception {
        StopException() { super("Stopped"); }
    }

    static final class UnknownStateException extends Exception {
        UnknownStateException(String m) { super(m); }
    }

    interface Task {
        void run() throws Exception;
    }

    Runner(MainActivity act, WebView site, Store store) {
        this.act = act;
        this.site = site;
        this.store = store;
        this.botJs = readAsset("bot.js");
    }

    final class Bridge {
        @JavascriptInterface
        public void done(String id, String json) {
            ArrayBlockingQueue<String> q = pending.get(id);
            if (q != null) q.offer(json);
        }
    }

    // ------------------------------------------------------------------ page events

    void onPageFinished(String url) {
        synchronized (loadLock) {
            loadCount++;
            loadLock.notifyAll();
        }
    }

    void onMainFrameError(String description) {
        lastLoadError = description;
        synchronized (loadLock) {
            loadCount++;
            loadLock.notifyAll();
        }
    }

    boolean isRunning() {
        return running;
    }

    void note(String message) {
        // Alerts shown by VCTS while a task runs are kept in the page helper's notes too.
    }

    void stop() {
        stopRequested = true;
    }

    // ------------------------------------------------------------------ tasks

    void runJob(String jobJson, boolean dry) {
        begin(dry ? "dry" : "real", () -> {
            JSONObject job = new JSONObject(jobJson);
            JSONArray bills = job.getJSONArray("bills");
            if (bills.length() == 0) throw new Exception("No bills.");

            step("login", "VCTS मा लगइन");
            ensureLogin();
            ok("login", null);

            step("form", "Consignment विवरण भर्दै");
            JSONObject info = jsObj("__vh.pageInfo()", 15000);
            String today = info.optString("today", "");
            if (today.isEmpty() || "null".equals(today)) throw new Exception("VCTS बाट आजको मिति पढ्न सकिएन।");

            JSONObject basic = new JSONObject();
            basic.put("vehicle", job.getString("vehicle"));
            basic.put("driverMobile", job.getString("driverMobile"));
            basic.put("deptDistrict", job.optString("deptDistrict"));
            basic.put("deptLocation", job.optString("deptLocation"));
            basic.put("destDistrict", job.getString("destDistrict"));
            basic.put("destExtra", job.optString("destExtra"));
            basic.put("departDate", today);
            basic.put("remarks", job.optString("remarks"));
            JSONObject filled = jsObj("__vh.fillBasic(" + basic + ")", 60000);
            ok("form", filled.optString("vehicle") + " • " + filled.optString("driver") + " • " + filled.optString("to") + " • " + filled.optString("date"));

            for (int i = 0; i < bills.length(); i++) {
                JSONObject bill = bills.getJSONObject(i);
                if (bill.optString("docDate", "").isEmpty()) bill.put("docDate", today);
                String key = "bill" + i;
                String label = ("1".equals(bill.optString("docType")) ? "बिल " : "चलान ") + bill.optString("docNo") + " — " + bill.optString("buyerName");
                step(key, label);
                jsObj("__vh.addDocRow()", 30000);
                JSONObject read = jsObj("__vh.fillDoc(" + bill + ")", 60000);
                String detail = read.optString("qty") + " " + read.optString("unit") + " • Rs " + read.optString("amount") + " • " + read.optString("buyer");
                if (dry) {
                    ok(key, "भरियो (save गरिएन) — " + detail);
                    JSONObject d = new JSONObject();
                    d.put("type", "done");
                    d.put("mode", "dry");
                    act.emit(d);
                    act.setSiteStatus("TEST — Save नथिच्नुहोस्");
                    return;
                }
                JSONObject saved = jsObj("__vh.saveDoc()", 90000);
                String cid = saved.optString("consignmentId", "");
                if (!cid.isEmpty()) consignmentId = cid;
                if (!saved.optBoolean("ok")) {
                    if (saved.optBoolean("unknown")) throw new UnknownStateException(saved.optString("error"));
                    throw new Exception(saved.optString("error", "VCTS did not save the bill."));
                }
                if (consignmentId.isEmpty()) throw new UnknownStateException("Bill saved but the consignment ID was not shown. Check the list in VCTS.");
                ok(key, "Save भयो — " + detail);
            }

            step("lock", "Consignment lock गर्दै (" + consignmentId + ")");
            loadAuthed(BASE + "/consignment/consignment_list");
            JSONObject lock = jsObj("__vh.lock(" + JSONObject.quote(consignmentId) + ")", 90000);
            ok("lock", lock.optBoolean("already") ? "पहिले नै locked" : lock.optString("message"));

            step("start", "Vehicle start गर्दै");
            loadAuthed(BASE + "/consignment/consignment_list");
            JSONObject start = jsObj("__vh.start(" + JSONObject.quote(consignmentId) + ")", 90000);
            ok("start", start.optBoolean("already") ? "पहिले नै started" : start.optString("message"));

            step("pdf", "PDF र फोटो (JPEG) बनाउँदै");
            JSONObject d = new JSONObject();
            d.put("type", "done");
            d.put("mode", "real");
            d.put("consignmentId", consignmentId);
            makeOutputs(consignmentId, d);
            act.emit(d);
        });
    }

    /** Saves the print page as PDF, then as a JPEG photo (also copied to the Gallery). Fills pdf/jpg/gallery/message. */
    private void makeOutputs(String cid, JSONObject d) throws Exception {
        File pdf = printToPdf(cid);
        File jpg = pdf != null ? pdfToJpeg(pdf, cid) : null;
        boolean gallery = jpg != null && copyToGallery(jpg);
        d.put("pdf", pdf != null ? pdf.getAbsolutePath() : "");
        d.put("jpg", jpg != null ? jpg.getAbsolutePath() : "");
        d.put("gallery", gallery);
        if (pdf == null) {
            d.put("message", "PDF आफैं save हुन सकेन — print screen खुलेको छ, त्यहाँ “Save as PDF” छान्नुहोस्।");
            ok("pdf", "print screen बाट “Save as PDF” छान्नुहोस्");
        } else {
            ok("pdf", jpg != null ? (gallery ? "Gallery को VCTS album मा फोटो save भयो" : "फोटो तयार") : "PDF तयार (फोटो बनेन)");
        }
    }

    void sync(String json) {
        begin("sync", () -> {
            JSONObject in = new JSONObject(json);
            step("login", "VCTS मा लगइन");
            ensureLogin();
            ok("login", null);
            step("check", "विवरण जाँच्दै");
            JSONObject info = jsObj("__vh.pageInfo()", 15000);
            String mobile = in.optString("driverMobile", "");
            if (!mobile.isEmpty()) info.put("driver", jsObj("__vh.checkDriver(" + JSONObject.quote(mobile) + ")", 30000));
            ok("check", info.optString("company"));
            JSONObject d = new JSONObject();
            d.put("type", "done");
            d.put("mode", "sync");
            d.put("info", info);
            act.emit(d);
        });
    }

    void reprint(String cid) {
        begin("reprint", () -> {
            consignmentId = cid;
            step("login", "VCTS मा लगइन");
            ensureLogin();
            ok("login", null);
            step("pdf", "PDF र फोटो (JPEG) बनाउँदै");
            JSONObject d = new JSONObject();
            d.put("type", "done");
            d.put("mode", "reprint");
            d.put("consignmentId", cid);
            makeOutputs(cid, d);
            act.emit(d);
        });
    }

    private void begin(String m, Task task) {
        if (running) {
            emitError(m, "अर्को काम चलिरहेको छ।", false, false);
            return;
        }
        running = true;
        stopRequested = false;
        mode = m;
        stage = "";
        consignmentId = "";
        exec.submit(() -> {
            try {
                task.run();
            } catch (StopException e) {
                emitError(mode, "तपाईंले रोक्नुभयो।", true, false);
            } catch (UnknownStateException e) {
                emitError(mode, e.getMessage(), false, true);
            } catch (Throwable e) {
                String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                emitError(mode, msg, false, false);
            } finally {
                running = false;
            }
        });
    }

    // ------------------------------------------------------------------ steps / events

    private void step(String id, String label) throws Exception {
        checkStop();
        stage = id;
        act.setSiteStatus(label);
        JSONObject o = new JSONObject();
        o.put("type", "step");
        o.put("id", id);
        o.put("label", label);
        o.put("state", "run");
        act.emit(o);
    }

    private void ok(String id, String detail) throws Exception {
        JSONObject o = new JSONObject();
        o.put("type", "step");
        o.put("id", id);
        o.put("state", "ok");
        if (detail != null && !detail.isEmpty()) o.put("detail", detail);
        act.emit(o);
    }

    private void emitError(String m, String message, boolean stopped, boolean unknown) {
        try {
            JSONObject s = new JSONObject();
            s.put("type", "step");
            s.put("id", stage.isEmpty() ? "x" : stage);
            s.put("state", "fail");
            s.put("detail", message);
            act.emit(s);
            JSONObject o = new JSONObject();
            o.put("type", "error");
            o.put("mode", m);
            o.put("message", message);
            o.put("stage", stage);
            o.put("stopped", stopped);
            o.put("unknown", unknown);
            if (!consignmentId.isEmpty() && !"reprint".equals(m)) o.put("consignmentId", consignmentId);
            act.emit(o);
            act.setSiteStatus("रोकियो: " + message);
        } catch (Exception ignored) {
        }
    }

    private void checkStop() throws StopException {
        if (stopRequested) throw new StopException();
    }

    // ------------------------------------------------------------------ login / navigation

    private JSONObject settings() {
        try {
            String s = store.get("settings");
            return s.isEmpty() ? new JSONObject() : new JSONObject(s);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void ensureLogin() throws Exception {
        String url = load(BASE + "/consignment/basic_info");
        if (!isLoginUrl(url)) return;
        login();
        url = currentUrl();
        if (!url.contains("/consignment/basic_info")) url = load(BASE + "/consignment/basic_info");
        if (isLoginUrl(url)) throw new Exception("लगइन भएन। सेटिङ मा user name / password जाँच्नुहोस्।");
    }

    private void loadAuthed(String target) throws Exception {
        String url = load(target);
        if (isLoginUrl(url)) {
            login();
            url = load(target);
            if (isLoginUrl(url)) throw new Exception("लगइन भएन।");
        }
    }

    private static boolean isLoginUrl(String url) {
        return url == null || url.contains("/login") || url.contains("/auth/login");
    }

    private void login() throws Exception {
        String user = settings().optString("username", "");
        if (user.isEmpty() || !store.hasPassword()) throw new Exception("सेटिङ मा VCTS user name र password राख्नुहोस्।");
        String pass = store.password();
        int before = loadMark();
        JSONObject r = jsObj("__vh.login(" + JSONObject.quote(user) + "," + JSONObject.quote(pass) + ")", 15000);
        if (r.optBoolean("noForm")) throw new Exception("VCTS login page चिनिएन।");
        waitLoad(before, 60000);
        String url = settle();
        if (isLoginUrl(url)) {
            String err = "";
            try {
                Object v = jsVal("__vh.loginError()", 8000);
                err = v == null ? "" : String.valueOf(v);
            } catch (Exception ignored) {
            }
            throw new Exception("लगइन भएन: " + err);
        }
    }

    private int loadMark() {
        synchronized (loadLock) {
            return loadCount;
        }
    }

    private String load(String url) throws Exception {
        checkStop();
        int before = loadMark();
        lastLoadError = null;
        main.post(() -> site.loadUrl(url));
        waitLoad(before, 60000);
        return settle();
    }

    private void waitLoad(int before, long timeoutMs) throws Exception {
        long end = System.currentTimeMillis() + timeoutMs;
        synchronized (loadLock) {
            while (loadCount == before) {
                checkStop();
                long left = end - System.currentTimeMillis();
                if (left <= 0) throw new Exception("VCTS page खुलेन। इन्टरनेट जाँच्नुहोस्।");
                loadLock.wait(Math.min(left, 300));
            }
        }
        if (lastLoadError != null) throw new Exception("VCTS खुलेन: " + lastLoadError);
    }

    /** Waits until the page has finished loading and its address stops changing. */
    private String settle() throws Exception {
        String prev = "";
        int stable = 0;
        long end = System.currentTimeMillis() + 40000;
        while (System.currentTimeMillis() < end) {
            checkStop();
            String s = unquote(evalSync("document.readyState + '|' + location.href", 10000));
            if (s.startsWith("complete|") && s.equals(prev)) {
                if (++stable >= 2) return s.substring("complete|".length());
            } else {
                stable = 0;
            }
            prev = s;
            Thread.sleep(400);
        }
        return currentUrl();
    }

    private String currentUrl() throws Exception {
        return unquote(evalSync("location.href", 10000));
    }

    // ------------------------------------------------------------------ JavaScript plumbing

    private static String unquote(String v) {
        if (v == null || "null".equals(v)) return "";
        try {
            return new JSONArray("[" + v + "]").getString(0);
        } catch (Exception e) {
            return v;
        }
    }

    private String evalSync(String code, long timeoutMs) throws Exception {
        ArrayBlockingQueue<String> q = new ArrayBlockingQueue<>(1);
        main.post(() -> site.evaluateJavascript(code, v -> q.offer(v == null ? "null" : v)));
        String v = poll(q, timeoutMs);
        if (v == null) throw new Exception("Browser ले जवाफ दिएन।");
        return v;
    }

    private void ensureBot() throws Exception {
        String has = evalSync("(typeof window.__vh === 'object' && window.__vh.v === 1)", 10000);
        if ("true".equals(has)) return;
        evalSync(botJs + "\n;true", 15000);
        has = evalSync("(typeof window.__vh === 'object' && window.__vh.v === 1)", 10000);
        if (!"true".equals(has)) throw new Exception("VCTS page मा helper चलेन।");
    }

    /** Runs an expression (may return a Promise) in the page and returns its value. */
    private Object jsVal(String expr, long timeoutMs) throws Exception {
        ensureBot();
        String id = "j" + seq.incrementAndGet();
        ArrayBlockingQueue<String> q = new ArrayBlockingQueue<>(1);
        pending.put(id, q);
        try {
            String code = "(async function(){try{var __r=await (" + expr + ");" +
                    "Bot.done('" + id + "',JSON.stringify({ok:true,v:(__r===undefined?null:__r)}));}" +
                    "catch(e){Bot.done('" + id + "',JSON.stringify({ok:false,e:String((e&&e.message)||e)}));}})();0";
            evalSync(code, 15000);
            String raw = poll(q, timeoutMs);
            if (raw == null) throw new Exception("VCTS ले धेरै समय लियो (" + (timeoutMs / 1000) + "s)।");
            JSONObject r = new JSONObject(raw);
            if (!r.optBoolean("ok")) throw new Exception(r.optString("e", "Unknown error"));
            return r.opt("v");
        } finally {
            pending.remove(id);
        }
    }

    private JSONObject jsObj(String expr, long timeoutMs) throws Exception {
        Object v = jsVal(expr, timeoutMs);
        return v instanceof JSONObject ? (JSONObject) v : new JSONObject();
    }

    private String poll(BlockingQueue<String> q, long timeoutMs) throws Exception {
        long end = System.currentTimeMillis() + timeoutMs;
        while (true) {
            checkStop();
            long left = end - System.currentTimeMillis();
            if (left <= 0) return null;
            String v = q.poll(Math.min(left, 300), TimeUnit.MILLISECONDS);
            if (v != null) return v;
        }
    }

    // ------------------------------------------------------------------ PDF

    private File printToPdf(String cid) throws Exception {
        loadAuthed(BASE + "/consignment/consignment_print/" + cid);
        JSONObject p = jsObj("__vh.preparePrint()", 10000);
        if (!p.optBoolean("ok")) throw new Exception("Print page मा consignment देखिएन।");
        jsVal("__vh.waitImages()", 20000);
        Thread.sleep(1500);

        File dir = new File(act.getFilesDir(), "pdf");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("PDF folder बन्न सकेन।");
        File out = new File(dir, "VCTS_" + cid + ".pdf");
        final String name = "VCTS_" + cid;

        ArrayBlockingQueue<String> q = new ArrayBlockingQueue<>(1);
        main.post(() -> {
            try {
                PrintDocumentAdapter adapter = site.createPrintDocumentAdapter(name);
                PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();
                PdfSaver.save(adapter, attrs, out, new PdfSaver.Done() {
                    @Override
                    public void ok(File file) {
                        q.offer("ok");
                    }

                    @Override
                    public void fail(String message) {
                        q.offer("fail:" + message);
                    }
                });
            } catch (Throwable t) {
                q.offer("fail:" + t);
            }
        });
        String r = poll(q, 90000);
        if ("ok".equals(r) && out.length() > 500) {
            copyToDownloads(out);
            return out;
        }
        main.post(() -> act.systemPrint(name));
        return null;
    }

    /** Also keeps a copy in Downloads/VCTS so it can be found in the Files app. */
    private void copyToDownloads(File f) {
        if (Build.VERSION.SDK_INT < 29) return;
        try {
            ContentResolver cr = act.getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, f.getName());
            v.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/VCTS");
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) return;
            try (OutputStream os = cr.openOutputStream(uri); InputStream is = new FileInputStream(f)) {
                if (os == null) return;
                byte[] buf = new byte[16384];
                int n;
                while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
            }
        } catch (Exception ignored) {
        }
    }

    /** Renders the saved PDF into one JPEG (pages stacked, empty bottom trimmed). */
    private File pdfToJpeg(File pdf, String cid) {
        final int width = 1400;
        final int gap = 24;
        List<Bitmap> pages = new ArrayList<>();
        try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY);
             PdfRenderer renderer = new PdfRenderer(fd)) {
            int n = Math.min(renderer.getPageCount(), 6);
            for (int i = 0; i < n; i++) {
                try (PdfRenderer.Page page = renderer.openPage(i)) {
                    int h = Math.round(page.getHeight() * (width / (float) page.getWidth()));
                    Bitmap bm = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888);
                    bm.eraseColor(Color.WHITE);
                    page.render(bm, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    int used = contentBottom(bm);
                    if (used <= 0) {
                        bm.recycle();
                        continue;
                    }
                    if (used < h) {
                        Bitmap cut = Bitmap.createBitmap(bm, 0, 0, width, used);
                        bm.recycle();
                        bm = cut;
                    }
                    pages.add(bm);
                }
            }
            if (pages.isEmpty()) return null;
            int total = 0;
            for (Bitmap b : pages) total += b.getHeight();
            total += gap * (pages.size() - 1);
            Bitmap out = Bitmap.createBitmap(width, total, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(out);
            c.drawColor(Color.WHITE);
            Paint line = new Paint();
            line.setColor(0xFFCCCCCC);
            int y = 0;
            for (int i = 0; i < pages.size(); i++) {
                Bitmap b = pages.get(i);
                c.drawBitmap(b, 0, y, null);
                y += b.getHeight();
                if (i < pages.size() - 1) {
                    c.drawRect(0, y + gap / 2f - 1, width, y + gap / 2f + 1, line);
                    y += gap;
                }
            }
            File dir = new File(act.getFilesDir(), "jpg");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File f = new File(dir, "VCTS_" + cid + ".jpg");
            try (FileOutputStream os = new FileOutputStream(f)) {
                out.compress(Bitmap.CompressFormat.JPEG, 92, os);
            }
            out.recycle();
            return f.length() > 0 ? f : null;
        } catch (Throwable t) {
            return null;
        } finally {
            for (Bitmap b : pages) if (!b.isRecycled()) b.recycle();
        }
    }

    /** Height of the page that has something on it, plus a small margin. */
    private static int contentBottom(Bitmap bm) {
        int w = bm.getWidth(), h = bm.getHeight();
        int[] row = new int[w];
        for (int y = h - 1; y >= 0; y--) {
            bm.getPixels(row, 0, w, 0, y, w, 1);
            for (int x = 0; x < w; x += 2) {
                int p = row[x];
                if (((p >> 16) & 0xff) < 235 || ((p >> 8) & 0xff) < 235 || (p & 0xff) < 235) {
                    return Math.min(h, y + 48);
                }
            }
        }
        return 0;
    }

    /** Copies the photo into Pictures/VCTS so it shows in the Gallery (Android 10 and newer). */
    private boolean copyToGallery(File f) {
        if (Build.VERSION.SDK_INT < 29) return false;
        try {
            ContentResolver cr = act.getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, f.getName());
            v.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/VCTS");
            Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) return false;
            try (OutputStream os = cr.openOutputStream(uri); InputStream is = new FileInputStream(f)) {
                if (os == null) return false;
                byte[] buf = new byte[16384];
                int n;
                while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ misc

    private String readAsset(String name) {
        try (InputStream is = act.getAssets().open(name)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            return new String(bo.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }
}
