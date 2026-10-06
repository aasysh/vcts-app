package android.print;

import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * Saves a WebView print document straight to a PDF file, without the print dialog.
 * (Lives in android.print because the result-callback constructors are package-private.)
 */
public final class PdfSaver {

    public interface Done {
        void ok(File file);

        void fail(String message);
    }

    private PdfSaver() {
    }

    public static void save(final PrintDocumentAdapter adapter, PrintAttributes attrs, final File out, final Done done) {
        adapter.onStart();
        adapter.onLayout(null, attrs, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                final ParcelFileDescriptor pfd;
                try {
                    pfd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE
                            | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                } catch (Exception e) {
                    adapter.onFinish();
                    done.fail(String.valueOf(e));
                    return;
                }
                adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, pfd, new CancellationSignal(),
                        new PrintDocumentAdapter.WriteResultCallback() {
                            @Override
                            public void onWriteFinished(PageRange[] pages) {
                                close(pfd);
                                adapter.onFinish();
                                done.ok(out);
                            }

                            @Override
                            public void onWriteFailed(CharSequence error) {
                                close(pfd);
                                adapter.onFinish();
                                done.fail(String.valueOf(error));
                            }

                            @Override
                            public void onWriteCancelled() {
                                close(pfd);
                                adapter.onFinish();
                                done.fail("cancelled");
                            }
                        });
            }

            @Override
            public void onLayoutFailed(CharSequence error) {
                adapter.onFinish();
                done.fail(String.valueOf(error));
            }

            @Override
            public void onLayoutCancelled() {
                adapter.onFinish();
                done.fail("cancelled");
            }
        }, new Bundle());
    }

    private static void close(ParcelFileDescriptor pfd) {
        try {
            pfd.close();
        } catch (Exception ignored) {
        }
    }
}
