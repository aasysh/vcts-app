package np.kamana.vcts;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Lets viewers and WhatsApp read the saved consignment PDFs and photos (read-only). */
public class PdfProvider extends ContentProvider {

    static Uri uriFor(Context c, File f) {
        return Uri.parse("content://" + c.getPackageName() + ".files/" + f.getParentFile().getName() + "/" + Uri.encode(f.getName()));
    }

    static String mimeOf(String name) {
        return name != null && name.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "application/pdf";
    }

    private File fileFor(Uri uri) {
        java.util.List<String> seg = uri.getPathSegments();
        if (seg == null || seg.size() != 2 || getContext() == null) return null;
        String dir = seg.get(0), name = seg.get(1);
        if (!("pdf".equals(dir) || "jpg".equals(dir))) return null;
        if (name.contains("/") || name.contains("..")) return null;
        File f = new File(new File(getContext().getFilesDir(), dir), name);
        return f.exists() ? f : null;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        if (f == null) throw new FileNotFoundException(uri.toString());
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return mimeOf(uri.getLastPathSegment());
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f = fileFor(uri);
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols);
        if (f == null) return c;
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
            else row[i] = null;
        }
        c.addRow(row);
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
