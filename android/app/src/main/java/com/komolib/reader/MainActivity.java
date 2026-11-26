package com.komolib.reader;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.Inflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int BACKUP_CHUNK_BYTES = 1024 * 1024; // 1 MB raw per JS bridge chunk
    private static final long MAX_SINGLE_META_ENTRY = 30L * 1024L * 1024L; // 30 MB
    private static final long MAX_TOTAL_META_BYTES = 55L * 1024L * 1024L; // 55 MB (incl. tiny covers)
    private static final long MAX_NON_ZIP_BYTES = 45L * 1024L * 1024L; // 45 MB
    private static final long MAX_EPUB_SCAN_BYTES = 60L * 1024L * 1024L; // 60 MB single epub
    private static final long MAX_PDF_SCAN_BYTES = 90L * 1024L * 1024L; // 90 MB single pdf
    private static final long MAX_THUMB_IMG_BYTES = 4L * 1024L * 1024L; // 4 MB cover image
    private static final int MAX_COVER_WIDTH = 220;
    private static final int MAX_COVER_HEIGHT = 320;
    private static final int MAX_COVERS_EXTRACTED = 1200;

    private ActivityResultLauncher<Intent> backupPickerLauncher;
    private ActivityResultLauncher<Intent> folderPickerLauncher;
    private volatile String pendingGoogleAuthPayload = "";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        backupPickerLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                    JSONObject cancelled = new JSONObject();
                    try {
                        cancelled.put("ok", false);
                        cancelled.put("cancelled", true);
                    } catch (Exception ignored) {
                    }
                    emitJsCallback("__komoNativeBackupReady", cancelled);
                    return;
                }
                Uri uri = result.getData().getData();
                processExternalBackupUri(uri);
            }
        );

        folderPickerLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                    JSONObject cancelled = new JSONObject();
                    try {
                        cancelled.put("ok", false);
                        cancelled.put("cancelled", true);
                    } catch (Exception ignored) {
                    }
                    emitJsCallback("__komoNativeFolderDone", cancelled);
                    return;
                }
                Uri treeUri = result.getData().getData();
                processLibraryFolderUri(treeUri);
            }
        );

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new KomoAndroidBridge(this), "KomoAndroid");
            this.bridge.getWebView().setVerticalScrollBarEnabled(false);
            this.bridge.getWebView().setHorizontalScrollBarEnabled(false);
        }

        // Intercept Android system back gesture / button so reading or modals return to the previous section instead of exiting the app
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(
                        "(function(){ return (typeof window.__komoHandleAndroidBack === 'function' && window.__komoHandleAndroidBack()) ? 'true' : 'false'; })()",
                        value -> {
                            boolean handled = "\"true\"".equals(value) || "true".equals(value);
                            if (!handled) {
                                moveTaskToBack(true);
                            }
                        }
                    );
                } else {
                    moveTaskToBack(true);
                }
            }
        });

        handleOAuthIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOAuthIntent(intent);
    }

    private void handleOAuthIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        if (!"com.komolib.reader".equalsIgnoreCase(data.getScheme())) return;
        String fragment = data.getFragment();
        String encoded = "";
        if (fragment != null && fragment.contains("gdrive_auth=")) {
            for (String part : fragment.split("&")) {
                if (part.startsWith("gdrive_auth=")) {
                    encoded = Uri.decode(part.substring("gdrive_auth=".length()));
                    break;
                }
            }
        }
        if (encoded.isEmpty()) {
            String q = data.getQueryParameter("gdrive_auth");
            if (q != null) encoded = q;
        }
        if (!encoded.isEmpty()) {
            pendingGoogleAuthPayload = encoded;
            JSONObject payload = new JSONObject();
            try {
                payload.put("encoded", encoded);
            } catch (Exception ignored) {
            }
            emitJsCallback("__komoGoogleAuthResult", payload);
        }
    }

    private String takePendingGoogleAuthPayload() {
        String val = pendingGoogleAuthPayload;
        pendingGoogleAuthPayload = "";
        return val != null ? val : "";
    }

    private File getBackupTempFile() {
        File dir = new File(getCacheDir(), "backup_import");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "komo_backup_payload.bin");
    }

    private File getBookScanTempFile() {
        File dir = new File(getCacheDir(), "backup_import");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "komo_book_scan.tmp");
    }

    private void emitJsCallback(String fnName, JSONObject payload) {
        final String safeJson = payload
            .toString()
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029");
        runOnUiThread(() -> {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript(
                    "window." + fnName + " && window." + fnName + "(" + safeJson + ");",
                    null
                );
            }
        });
    }

    private void emitBackupStatus(String fileName, long originalSize, String message) {
        JSONObject statusPayload = new JSONObject();
        try {
            statusPayload.put("status", "analyzing");
            statusPayload.put("fileName", fileName);
            statusPayload.put("originalSize", originalSize);
            if (message != null && !message.isEmpty()) {
                statusPayload.put("message", message);
            }
        } catch (Exception ignored) {
        }
        emitJsCallback("__komoNativeBackupStatus", statusPayload);
    }

    private void launchExternalBackupPicker() {
        runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                );
                backupPickerLauncher.launch(intent);
            } catch (Exception e) {
                JSONObject err = new JSONObject();
                try {
                    err.put("ok", false);
                    err.put("error", e.getMessage() != null ? e.getMessage() : "No se pudo abrir el selector de archivos");
                } catch (Exception ignored) {
                }
                emitJsCallback("__komoNativeBackupReady", err);
            }
        });
    }

    private void processExternalBackupUri(Uri uri) {
        new Thread(() -> {
            String displayName = "backup";
            long originalSize = -1L;

            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIdx >= 0) {
                        String n = cursor.getString(nameIdx);
                        if (n != null && !n.trim().isEmpty()) displayName = n.trim();
                    }
                    int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        originalSize = cursor.getLong(sizeIdx);
                    }
                }
            } catch (Exception ignored) {
            }

            emitBackupStatus(displayName, originalSize, null);

            File tempFile = getBackupTempFile();
            File scanFile = getBookScanTempFile();
            if (tempFile.exists()) tempFile.delete();
            if (scanFile.exists()) scanFile.delete();

            try {
                byte[] magic = new byte[4];
                int magicRead = 0;
                try (InputStream is = getContentResolver().openInputStream(uri)) {
                    if (is == null) throw new IOException("Android no permitió abrir el archivo seleccionado.");
                    while (magicRead < 4) {
                        int r = is.read(magic, magicRead, 4 - magicRead);
                        if (r < 0) break;
                        magicRead += r;
                    }
                }

                boolean isZip =
                    magicRead >= 4 &&
                    magic[0] == 0x50 &&
                    magic[1] == 0x4b &&
                    (magic[2] == 0x03 || magic[2] == 0x05) &&
                    (magic[3] == 0x04 || magic[3] == 0x06);

                boolean isExtractedZip = false;
                int skippedLargeCount = 0;
                int keptCount = 0;
                int coversCount = 0;
                int booksScannedCount = 0;
                int thumbsFoundCount = 0;

                if (isZip) {
                    ExtractionStats stats = null;
                    final String finalName = displayName;
                    // Fast random-access ZIP/ZIP64 Central Directory extraction (handles 2 GB - 20+ GB)
                    try (ParcelFileDescriptor pfd = getContentResolver().openFileDescriptor(uri, "r")) {
                        if (pfd != null) {
                            try (FileInputStream fis = new FileInputStream(pfd.getFileDescriptor())) {
                                FileChannel ch = fis.getChannel();
                                long chSize = ch.size();
                                if (chSize > 22) {
                                    if (originalSize <= 0) originalSize = chSize;
                                    final long finalSize = originalSize;
                                    stats = extractZipMetadataViaChannel(
                                        ch,
                                        chSize,
                                        tempFile,
                                        scanFile,
                                        msg -> emitBackupStatus(finalName, finalSize, msg)
                                    );
                                }
                            }
                        }
                    } catch (Exception ignored) {
                        stats = null;
                    }

                    // Fallback to streaming ZipInputStream if URI is non-seekable (e.g. cloud drive)
                    if (stats == null) {
                        if (tempFile.exists()) tempFile.delete();
                        final long finalSize = originalSize;
                        try (InputStream raw = getContentResolver().openInputStream(uri)) {
                            if (raw == null) throw new IOException("No se pudo leer el flujo del archivo.");
                            stats = extractZipMetadataViaStream(
                                new BufferedInputStream(raw, 65536),
                                tempFile,
                                scanFile,
                                msg -> emitBackupStatus(finalName, finalSize, msg)
                            );
                        }
                    }

                    isExtractedZip = true;
                    skippedLargeCount = stats.skippedCount;
                    keptCount = stats.keptCount;
                    coversCount = stats.coversCount;
                    booksScannedCount = stats.booksScannedCount;
                    thumbsFoundCount = stats.thumbsFoundCount;
                } else {
                    long written = 0;
                    try (
                        InputStream raw = getContentResolver().openInputStream(uri);
                        FileOutputStream fos = new FileOutputStream(tempFile)
                    ) {
                        if (raw == null) throw new IOException("No se pudo abrir el archivo seleccionado.");
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = raw.read(buf)) != -1) {
                            if (written + n > MAX_NON_ZIP_BYTES) {
                                int allowed = (int) Math.max(0, MAX_NON_ZIP_BYTES - written);
                                if (allowed > 0) {
                                    fos.write(buf, 0, allowed);
                                    written += allowed;
                                }
                                break;
                            }
                            fos.write(buf, 0, n);
                            written += n;
                        }
                    }
                    if (originalSize <= 0) originalSize = written;
                }

                if (scanFile.exists()) scanFile.delete();

                long payloadSize = tempFile.length();
                int chunkCount = (int) ((payloadSize + BACKUP_CHUNK_BYTES - 1L) / BACKUP_CHUNK_BYTES);

                JSONObject ready = new JSONObject();
                ready.put("ok", true);
                ready.put("fileName", displayName);
                ready.put("originalSize", originalSize);
                ready.put("payloadSize", payloadSize);
                ready.put("chunkCount", chunkCount);
                ready.put("isExtractedZip", isExtractedZip);
                ready.put("keptCount", keptCount);
                ready.put("skippedCount", skippedLargeCount);
                ready.put("coversCount", coversCount);
                ready.put("booksScannedCount", booksScannedCount);
                ready.put("thumbsFoundCount", thumbsFoundCount);
                emitJsCallback("__komoNativeBackupReady", ready);
            } catch (Exception e) {
                if (tempFile.exists()) tempFile.delete();
                if (scanFile.exists()) scanFile.delete();
                JSONObject err = new JSONObject();
                try {
                    err.put("ok", false);
                    err.put("fileName", displayName);
                    err.put(
                        "error",
                        e.getMessage() != null ? e.getMessage() : "No se pudo leer el archivo de copia"
                    );
                } catch (Exception ignored) {
                }
                emitJsCallback("__komoNativeBackupReady", err);
            }
        }).start();
    }

    private interface ProgressCallback {
        void onMessage(String msg);
    }

    private static class ExtractionStats {
        int keptCount = 0;
        int skippedCount = 0;
        int coversCount = 0;
        int booksScannedCount = 0;
        int thumbsFoundCount = 0;
    }

    private static class ZipCdEntry {
        String name;
        int method;
        long compSize;
        long uncompSize;
        long localHeaderOffset;
    }

    private static class ExtractedBookInfo {
        String title;
        String author;
        String description;
        String format;
        int pageCount;
        byte[] coverJpeg;
    }

    private static void readFully(FileChannel ch, long pos, ByteBuffer buf) throws IOException {
        buf.clear();
        long cur = pos;
        while (buf.hasRemaining()) {
            int r = ch.read(buf, cur);
            if (r < 0) break;
            cur += r;
        }
        buf.flip();
    }

    private static boolean isImageFileName(String lower) {
        return (
            lower.endsWith(".jpg") ||
            lower.endsWith(".jpeg") ||
            lower.endsWith(".png") ||
            lower.endsWith(".webp") ||
            lower.endsWith(".bmp") ||
            lower.endsWith(".tn")
        );
    }

    private static boolean isCoverImagePath(String lower) {
        if (!isImageFileName(lower)) return false;
        // Skip Android app UI drawables/themes; keep Moon+ .tn thumbnails and all book cover images
        if (lower.contains("/drawable") || lower.contains("/mipmap") || lower.contains("/theme/") || lower.contains("/bg/")) {
            return false;
        }
        return true;
    }

    private static boolean isEpubName(String lower) {
        return lower.endsWith(".epub");
    }

    private static boolean isPdfName(String lower) {
        return lower.endsWith(".pdf");
    }

    private static boolean isHeavyMediaOrOtherBookName(String lower) {
        return (
            lower.endsWith(".cbz") ||
            lower.endsWith(".cbr") ||
            lower.endsWith(".mobi") ||
            lower.endsWith(".azw") ||
            lower.endsWith(".azw3") ||
            lower.endsWith(".fb2") ||
            lower.endsWith(".docx") ||
            lower.endsWith(".djvu") ||
            lower.endsWith(".mp3") ||
            lower.endsWith(".mp4") ||
            lower.endsWith(".m4a") ||
            lower.endsWith(".m4b") ||
            lower.endsWith(".aac") ||
            lower.endsWith(".ogg") ||
            lower.endsWith(".oga") ||
            lower.endsWith(".opus") ||
            lower.endsWith(".wav") ||
            lower.endsWith(".flac") ||
            lower.endsWith(".webm") ||
            lower.endsWith(".wma") ||
            lower.endsWith(".amr") ||
            lower.endsWith(".3gp") ||
            lower.endsWith(".aif") ||
            lower.endsWith(".aiff") ||
            lower.endsWith(".alac") ||
            lower.endsWith(".mka") ||
            lower.endsWith(".gif") ||
            lower.endsWith(".ttf") ||
            lower.endsWith(".otf") ||
            lower.endsWith(".woff") ||
            lower.endsWith(".woff2") ||
            lower.endsWith(".apk") ||
            lower.endsWith(".so") ||
            lower.endsWith(".dex") ||
            lower.endsWith("-shm") ||
            lower.endsWith("-wal") ||
            lower.endsWith(".journal")
        );
    }

    private static boolean isMetadataName(String lower) {
        return (
            lower.endsWith("_names.list") ||
            lower.contains("mrbooks") ||
            lower.endsWith(".db") ||
            lower.endsWith(".sqlite") ||
            lower.endsWith(".sqlite3") ||
            lower.endsWith(".po") ||
            lower.endsWith(".mrexpt") ||
            lower.endsWith(".xml") ||
            lower.endsWith(".json") ||
            lower.endsWith(".csv") ||
            lower.endsWith(".tsv") ||
            lower.endsWith(".txt") ||
            lower.endsWith(".lua") ||
            lower.endsWith(".opml") ||
            lower.contains("library") ||
            lower.contains("history") ||
            lower.contains("favourites") ||
            lower.contains("favorites") ||
            lower.contains("bookmarks") ||
            lower.contains("notes")
        );
    }

    private static boolean isImageMagic(byte[] head, int len) {
        if (len < 4) return false;
        // PNG
        if ((head[0] & 0xff) == 0x89 && head[1] == 0x50 && head[2] == 0x4e && head[3] == 0x47) return true;
        // JPEG
        if ((head[0] & 0xff) == 0xff && (head[1] & 0xff) == 0xd8 && (head[2] & 0xff) == 0xff) return true;
        // WEBP (RIFF....WEBP)
        if (len >= 12 && head[0] == 0x52 && head[1] == 0x49 && head[2] == 0x46 && head[3] == 0x46 && head[8] == 0x57 && head[9] == 0x45) return true;
        return false;
    }

    private static boolean isZipMagicHead(byte[] head, int len) {
        return len >= 4 && head[0] == 0x50 && head[1] == 0x4b && head[2] == 0x03 && head[3] == 0x04;
    }

    private static boolean isPdfMagicHead(byte[] head, int len) {
        return len >= 4 && head[0] == 0x25 && head[1] == 0x50 && head[2] == 0x44 && head[3] == 0x46;
    }

    private static boolean isHeavyBinaryHead(byte[] head, int len) {
        if (len >= 4) {
            if (isZipMagicHead(head, len)) return true;
            if (isPdfMagicHead(head, len)) return true;
            if (head[0] == 0x52 && head[1] == 0x61 && head[2] == 0x72 && head[3] == 0x21) return true; // Rar!
            if (isImageMagic(head, len)) return true;
            if (head[0] == 0x47 && head[1] == 0x49 && head[2] == 0x46 && head[3] == 0x38) return true; // GIF
        }
        return false;
    }

    private static boolean isSqliteHead(byte[] head, int len) {
        if (len < 15) return false;
        String s = new String(head, 0, 15, StandardCharsets.US_ASCII);
        return s.startsWith("SQLite format 3");
    }

    private static byte[] compressImageToThumbnailJpeg(byte[] rawImg) {
        if (rawImg == null || rawImg.length < 32) return null;
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(rawImg, 0, rawImg.length, bounds);
            int w = bounds.outWidth;
            int h = bounds.outHeight;
            if (w <= 0 || h <= 0) return null;
            // Skip tiny icons (< 40px)
            if (w < 40 || h < 40) return null;

            int inSample = 1;
            while ((w / (inSample * 2)) >= MAX_COVER_WIDTH && (h / (inSample * 2)) >= MAX_COVER_HEIGHT) {
                inSample *= 2;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = inSample;
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap bmp = BitmapFactory.decodeByteArray(rawImg, 0, rawImg.length, opts);
            if (bmp == null) return null;

            float scale = Math.min(
                1.0f,
                Math.min((float) MAX_COVER_WIDTH / bmp.getWidth(), (float) MAX_COVER_HEIGHT / bmp.getHeight())
            );
            int tw = Math.max(1, Math.round(bmp.getWidth() * scale));
            int th = Math.max(1, Math.round(bmp.getHeight() * scale));
            Bitmap flattened = Bitmap.createBitmap(tw, th, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(flattened);
            canvas.drawColor(Color.WHITE);
            android.graphics.Rect dst = new android.graphics.Rect(0, 0, tw, th);
            android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG);
            canvas.drawBitmap(bmp, null, dst, paint);
            bmp.recycle();

            ByteArrayOutputStream out = new ByteArrayOutputStream(16384);
            flattened.compress(Bitmap.CompressFormat.JPEG, 76, out);
            flattened.recycle();
            byte[] jpeg = out.toByteArray();
            return jpeg.length > 100 ? jpeg : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String decodeXmlEntities(String raw) {
        if (raw == null) return "";
        String s = raw.replaceAll("<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>", "$1");
        s = s.replaceAll("<[^>]+>", " ");
        s = s
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&#39;", "'")
            .replace("&#x27;", "'")
            .replace("&nbsp;", " ");
        // Decode numeric entities like &#225; or &#xe1;
        Matcher m = Pattern.compile("&#(x?[0-9a-fA-F]+);").matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            try {
                String tok = m.group(1);
                int cp = tok.startsWith("x") || tok.startsWith("X")
                    ? Integer.parseInt(tok.substring(1), 16)
                    : Integer.parseInt(tok, 10);
                m.appendReplacement(sb, Matcher.quoteReplacement(new String(Character.toChars(cp))));
            } catch (Exception ignored) {
                m.appendReplacement(sb, "");
            }
        }
        m.appendTail(sb);
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    private static byte[] readAllLimited(InputStream is, int maxBytes) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int total = 0;
        int r;
        while ((r = is.read(buf)) != -1) {
            if (total + r > maxBytes) {
                return null;
            }
            baos.write(buf, 0, r);
            total += r;
        }
        return baos.toByteArray();
    }

    private static String resolveRelativeZipPath(String baseDir, String href) {
        if (href == null || href.isEmpty()) return "";
        String cleanHref = href.split("#")[0].split("\\?")[0].replace("\\", "/");
        try {
            cleanHref = java.net.URLDecoder.decode(cleanHref, "UTF-8");
        } catch (Exception ignored) {
        }
        if (cleanHref.startsWith("/")) cleanHref = cleanHref.substring(1);
        String joined = (baseDir == null || baseDir.isEmpty()) ? cleanHref : baseDir + "/" + cleanHref;
        String[] parts = joined.split("/");
        List<String> stack = new ArrayList<>();
        for (String part : parts) {
            if (part.isEmpty() || part.equals(".")) continue;
            if (part.equals("..")) {
                if (!stack.isEmpty()) stack.remove(stack.size() - 1);
            } else {
                stack.add(part);
            }
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < stack.size(); i++) {
            if (i > 0) sb.append('/');
            sb.append(stack.get(i));
        }
        return sb.toString();
    }

    private static ZipEntry findZipEntryIgnoreCase(ZipFile zf, String path) {
        if (path == null || path.isEmpty()) return null;
        ZipEntry exact = zf.getEntry(path);
        if (exact != null) return exact;
        String targetLow = path.toLowerCase(Locale.ROOT);
        Enumeration<? extends ZipEntry> en = zf.entries();
        while (en.hasMoreElements()) {
            ZipEntry e = en.nextElement();
            if (e.getName().toLowerCase(Locale.ROOT).equals(targetLow)) {
                return e;
            }
        }
        return null;
    }

    private static String extractImageHrefFromXhtml(ZipFile zf, String xhtmlPath) {
        if (xhtmlPath == null || xhtmlPath.isEmpty()) return null;
        ZipEntry xhtmlEntry = findZipEntryIgnoreCase(zf, xhtmlPath);
        if (xhtmlEntry == null) return null;
        try (InputStream is = zf.getInputStream(xhtmlEntry)) {
            byte[] hb = readAllLimited(is, 512 * 1024);
            if (hb == null) return null;
            String html = new String(hb, StandardCharsets.UTF_8);
            String xhtmlDir = xhtmlPath.contains("/") ? xhtmlPath.substring(0, xhtmlPath.lastIndexOf('/')) : "";
            Pattern[] pats = new Pattern[] {
                Pattern.compile("<img\\b[^>]*\\bsrc\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE),
                Pattern.compile("<image\\b[^>]*\\b(?:xlink:href|href)\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE),
            };
            for (Pattern pat : pats) {
                Matcher m = pat.matcher(html);
                if (m.find()) {
                    String src = m.group(1).trim();
                    if (!src.isEmpty() && !src.startsWith("data:")) {
                        String resolved = resolveRelativeZipPath(xhtmlDir, src);
                        if (findZipEntryIgnoreCase(zf, resolved) != null) return resolved;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private static ExtractedBookInfo inspectEpubFile(File epubFile) {
        ExtractedBookInfo info = new ExtractedBookInfo();
        info.format = "epub";
        try (ZipFile zf = new ZipFile(epubFile)) {
            String opfPath = null;
            ZipEntry containerEntry = findZipEntryIgnoreCase(zf, "META-INF/container.xml");
            if (containerEntry != null) {
                try (InputStream is = zf.getInputStream(containerEntry)) {
                    byte[] cb = readAllLimited(is, 256 * 1024);
                    if (cb != null) {
                        String cXml = new String(cb, StandardCharsets.UTF_8);
                        Matcher m = Pattern.compile("full-path\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(cXml);
                        if (m.find()) opfPath = m.group(1).trim();
                    }
                }
            }

            ZipEntry opfEntry = opfPath != null ? findZipEntryIgnoreCase(zf, opfPath) : null;
            if (opfEntry == null) {
                Enumeration<? extends ZipEntry> en = zf.entries();
                while (en.hasMoreElements()) {
                    ZipEntry e = en.nextElement();
                    if (e.getName().toLowerCase(Locale.ROOT).endsWith(".opf")) {
                        opfEntry = e;
                        opfPath = e.getName();
                        break;
                    }
                }
            }

            String coverHref = null;
            String opfDir = "";
            if (opfPath != null && opfPath.contains("/")) {
                opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
            }

            List<String> xhtmlCoverCandidates = new ArrayList<>();
            Map<String, String> idToHref = new HashMap<>();
            Map<String, String> idToMedia = new HashMap<>();

            if (opfEntry != null) {
                try (InputStream is = zf.getInputStream(opfEntry)) {
                    byte[] ob = readAllLimited(is, 2 * 1024 * 1024);
                    if (ob != null) {
                        String opf = new String(ob, StandardCharsets.UTF_8);

                        // Extract <dc:title>
                        Matcher tm = Pattern.compile("<(?:[a-zA-Z0-9_-]+:)?title\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?title>", Pattern.CASE_INSENSITIVE).matcher(opf);
                        if (tm.find()) {
                            String t = decodeXmlEntities(tm.group(1));
                            if (!t.isEmpty()) info.title = t;
                        }

                        // Extract <dc:creator> tags (preferring primary authors over translators/editors)
                        Matcher cm = Pattern.compile("<(?:[a-zA-Z0-9_-]+:)?creator\\b([^>]*)>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?creator>", Pattern.CASE_INSENSITIVE).matcher(opf);
                        List<String> primaryAuthors = new ArrayList<>();
                        List<String> fallbackAuthors = new ArrayList<>();
                        while (cm.find()) {
                            String attrs = cm.group(1) != null ? cm.group(1).toLowerCase(Locale.ROOT) : "";
                            String a = decodeXmlEntities(cm.group(2));
                            if (a.isEmpty()) continue;
                            Matcher roleM = Pattern.compile("\\b(?:opf:)?role\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(attrs);
                            String role = roleM.find() ? roleM.group(1).trim().toLowerCase(Locale.ROOT) : "";
                            if (role.isEmpty() || "aut".equals(role) || "author".equals(role)) {
                                if (!primaryAuthors.contains(a)) primaryAuthors.add(a);
                            } else if (!fallbackAuthors.contains(a)) {
                                fallbackAuthors.add(a);
                            }
                        }
                        List<String> authors = !primaryAuthors.isEmpty() ? primaryAuthors : fallbackAuthors;
                        if (authors.isEmpty()) {
                            Matcher authMeta = Pattern.compile("<meta\\b[^>]*property\\s*=\\s*[\"']dcterms:creator[\"'][^>]*>([\\s\\S]*?)</meta>", Pattern.CASE_INSENSITIVE).matcher(opf);
                            if (authMeta.find()) {
                                String a = decodeXmlEntities(authMeta.group(1));
                                if (!a.isEmpty()) authors.add(a);
                            }
                        }
                        if (authors.isEmpty()) {
                            Matcher authMeta2 = Pattern.compile("<meta\\b[^>]*name\\s*=\\s*[\"']author[\"'][^>]*content\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(opf);
                            if (authMeta2.find()) {
                                String a = decodeXmlEntities(authMeta2.group(1));
                                if (!a.isEmpty()) authors.add(a);
                            }
                        }
                        if (!authors.isEmpty()) {
                            StringBuilder ab = new StringBuilder();
                            for (int i = 0; i < authors.size(); i++) {
                                if (i > 0) ab.append(", ");
                                ab.append(authors.get(i));
                            }
                            info.author = ab.toString();
                        }

                        // Extract <dc:description>
                        Matcher dm = Pattern.compile("<(?:[a-zA-Z0-9_-]+:)?description\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?description>", Pattern.CASE_INSENSITIVE).matcher(opf);
                        if (dm.find()) {
                            String d = decodeXmlEntities(dm.group(1));
                            if (!d.isEmpty()) {
                                info.description = d.length() > 500 ? d.substring(0, 500) : d;
                            }
                        }

                        // Find cover meta id / href
                        String coverMetaId = null;
                        Matcher metaCover1 = Pattern.compile("<meta\\b[^>]*name\\s*=\\s*[\"']cover[\"'][^>]*content\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(opf);
                        Matcher metaCover2 = Pattern.compile("<meta\\b[^>]*content\\s*=\\s*[\"']([^\"']+)[\"'][^>]*name\\s*=\\s*[\"']cover[\"']", Pattern.CASE_INSENSITIVE).matcher(opf);
                        if (metaCover1.find()) coverMetaId = metaCover1.group(1).trim();
                        else if (metaCover2.find()) coverMetaId = metaCover2.group(1).trim();

                        Matcher itemM = Pattern.compile("<item\\b([^>]+)/?>", Pattern.CASE_INSENSITIVE).matcher(opf);
                        String fallbackImgHref = null;
                        while (itemM.find()) {
                            String attrs = itemM.group(1);
                            Matcher idM = Pattern.compile("\\bid\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(attrs);
                            Matcher hrefM = Pattern.compile("\\bhref\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(attrs);
                            Matcher mediaM = Pattern.compile("\\bmedia-type\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(attrs);
                            Matcher propM = Pattern.compile("\\bproperties\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(attrs);
                            String idVal = idM.find() ? idM.group(1).trim() : "";
                            String hrefVal = hrefM.find() ? hrefM.group(1).trim() : "";
                            String mediaVal = mediaM.find() ? mediaM.group(1).toLowerCase(Locale.ROOT) : "";
                            String propVal = propM.find() ? propM.group(1).toLowerCase(Locale.ROOT) : "";
                            if (hrefVal.isEmpty()) continue;

                            if (!idVal.isEmpty()) {
                                idToHref.put(idVal, hrefVal);
                                idToMedia.put(idVal, mediaVal);
                            }

                            boolean isImg = mediaVal.startsWith("image/") || isImageFileName(hrefVal.toLowerCase(Locale.ROOT));
                            boolean isHtml = mediaVal.contains("html") || mediaVal.contains("xml") || hrefVal.toLowerCase(Locale.ROOT).endsWith(".xhtml") || hrefVal.toLowerCase(Locale.ROOT).endsWith(".html");

                            if (propVal.contains("cover-image") && isImg) {
                                coverHref = hrefVal;
                            }
                            if (coverHref == null && coverMetaId != null && (idVal.equalsIgnoreCase(coverMetaId) || hrefVal.equalsIgnoreCase(coverMetaId) || hrefVal.endsWith("/" + coverMetaId))) {
                                if (isImg) {
                                    coverHref = hrefVal;
                                } else if (isHtml) {
                                    xhtmlCoverCandidates.add(resolveRelativeZipPath(opfDir, hrefVal));
                                }
                            }
                            if (isImg && (idVal.toLowerCase(Locale.ROOT).contains("cover") || hrefVal.toLowerCase(Locale.ROOT).contains("cover") || hrefVal.toLowerCase(Locale.ROOT).contains("portada") || hrefVal.toLowerCase(Locale.ROOT).contains("front"))) {
                                if (fallbackImgHref == null) fallbackImgHref = hrefVal;
                            }
                            if (isHtml && (idVal.toLowerCase(Locale.ROOT).contains("cover") || hrefVal.toLowerCase(Locale.ROOT).contains("cover") || hrefVal.toLowerCase(Locale.ROOT).contains("titlepage") || hrefVal.toLowerCase(Locale.ROOT).contains("portada"))) {
                                xhtmlCoverCandidates.add(resolveRelativeZipPath(opfDir, hrefVal));
                            }
                        }

                        if (coverHref == null && coverMetaId != null && isImageFileName(coverMetaId.toLowerCase(Locale.ROOT))) {
                            coverHref = coverMetaId;
                        }
                        if (coverHref == null) coverHref = fallbackImgHref;

                        // Check <guide><reference type="cover" href="..."/> and 1st spine itemref
                        if (coverHref == null) {
                            Matcher guideM = Pattern.compile("<reference\\b[^>]*type\\s*=\\s*[\"'][^\"']*cover[^\"']*[\"'][^>]*href\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(opf);
                            if (guideM.find()) {
                                xhtmlCoverCandidates.add(0, resolveRelativeZipPath(opfDir, guideM.group(1).trim()));
                            }
                            Matcher spineM = Pattern.compile("<itemref\\b[^>]*idref\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(opf);
                            if (spineM.find()) {
                                String firstHref = idToHref.get(spineM.group(1).trim());
                                if (firstHref != null) {
                                    xhtmlCoverCandidates.add(resolveRelativeZipPath(opfDir, firstHref));
                                }
                            }
                        }
                    }
                }
            }

            // Locate cover entry inside EPUB
            ZipEntry coverEntry = null;
            if (coverHref != null) {
                coverEntry = findZipEntryIgnoreCase(zf, resolveRelativeZipPath(opfDir, coverHref));
                if (coverEntry == null) coverEntry = findZipEntryIgnoreCase(zf, coverHref);
            }
            // Step 4 (parity with Web epubParser): extract <img> or <svg><image> from cover/titlepage/1st spine XHTML!
            if (coverEntry == null) {
                for (String xhtmlPath : xhtmlCoverCandidates) {
                    String foundPath = extractImageHrefFromXhtml(zf, xhtmlPath);
                    if (foundPath != null) {
                        coverEntry = findZipEntryIgnoreCase(zf, foundPath);
                        if (coverEntry != null) break;
                    }
                }
            }
            // Step 5: Fallback — look for named cover image or largest sizable image (>= 8 KB) in EPUB
            if (coverEntry == null) {
                ZipEntry namedCover = null;
                ZipEntry largestImg = null;
                long largestSize = 0;
                Enumeration<? extends ZipEntry> en = zf.entries();
                while (en.hasMoreElements()) {
                    ZipEntry e = en.nextElement();
                    if (e.isDirectory()) continue;
                    String low = e.getName().toLowerCase(Locale.ROOT);
                    if (!isImageFileName(low) || low.endsWith(".tn")) continue;
                    if (low.contains("cover") || low.contains("portada") || low.contains("front")) {
                        namedCover = e;
                        break;
                    }
                    long sz = e.getSize();
                    if (sz >= 8192 && sz <= MAX_THUMB_IMG_BYTES && sz > largestSize) {
                        largestSize = sz;
                        largestImg = e;
                    }
                }
                coverEntry = namedCover != null ? namedCover : largestImg;
            }

            if (coverEntry != null && (coverEntry.getSize() < 0 || coverEntry.getSize() <= MAX_THUMB_IMG_BYTES)) {
                try (InputStream is = zf.getInputStream(coverEntry)) {
                    byte[] rawImg = readAllLimited(is, (int) MAX_THUMB_IMG_BYTES);
                    info.coverJpeg = compressImageToThumbnailJpeg(rawImg);
                }
            }
        } catch (Throwable ignored) {
        }
        return info;
    }

    private static String decodePdfBytesString(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return null;
        try {
            if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFE && (bytes[1] & 0xFF) == 0xFF) {
                return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16BE).trim();
            }
            if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xFE) {
                return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16LE).trim();
            }
            return new String(bytes, StandardCharsets.ISO_8859_1).trim();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String extractPdfInfoField(String text, String fieldName) {
        // 1. Literal string: /Title (...) — supports UTF-16BE BOM (\u00fe\u00ff) for Spanish accents!
        Matcher m = Pattern.compile("/" + fieldName + "\\s*\\(([^()]{1,400})\\)").matcher(text);
        if (m.find()) {
            String raw = m.group(1)
                .replace("\\(", "(")
                .replace("\\)", ")")
                .replace("\\\\", "\\");
            byte[] rawBytes = raw.getBytes(StandardCharsets.ISO_8859_1);
            String decoded = decodePdfBytesString(rawBytes);
            if (decoded != null && !decoded.isEmpty()) {
                return decoded;
            }
        }
        // 2. Hex string: /Title <FEFF0045...>
        Matcher hexM = Pattern.compile("/" + fieldName + "\\s*<([0-9A-Fa-f\\s]{4,800})>").matcher(text);
        if (hexM.find()) {
            String hex = hexM.group(1).replaceAll("\\s+", "");
            if (hex.length() % 2 == 1) hex += "0";
            byte[] out = new byte[hex.length() / 2];
            for (int i = 0; i < out.length; i++) {
                out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
            }
            String decoded = decodePdfBytesString(out);
            if (decoded != null && !decoded.isEmpty()) {
                return decoded;
            }
        }
        return null;
    }

    private static ExtractedBookInfo inspectPdfFile(File pdfFile) {
        ExtractedBookInfo info = new ExtractedBookInfo();
        info.format = "pdf";
        // Best-effort /Title & /Author from PDF header/trailer bytes
        try (RandomAccessFile raf = new RandomAccessFile(pdfFile, "r")) {
            long len = raf.length();
            int headLen = (int) Math.min(len, 65536L);
            byte[] head = new byte[headLen];
            raf.readFully(head);
            String headStr = new String(head, StandardCharsets.ISO_8859_1);
            info.title = extractPdfInfoField(headStr, "Title");
            info.author = extractPdfInfoField(headStr, "Author");
            if ((info.title == null || info.author == null) && len > 65536L) {
                int tailLen = (int) Math.min(len, 65536L);
                byte[] tail = new byte[tailLen];
                raf.seek(len - tailLen);
                raf.readFully(tail);
                String tailStr = new String(tail, StandardCharsets.ISO_8859_1);
                if (info.title == null) info.title = extractPdfInfoField(tailStr, "Title");
                if (info.author == null) info.author = extractPdfInfoField(tailStr, "Author");
            }
        } catch (Throwable ignored) {
        }

        // Render Page 1 cover using native Android PdfRenderer
        try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY)) {
            try (PdfRenderer renderer = new PdfRenderer(pfd)) {
                info.pageCount = renderer.getPageCount();
                if (info.pageCount > 0) {
                    try (PdfRenderer.Page page = renderer.openPage(0)) {
                        int pw = Math.max(1, page.getWidth());
                        int ph = Math.max(1, page.getHeight());
                        float scale = Math.min((float) MAX_COVER_WIDTH / pw, (float) MAX_COVER_HEIGHT / ph);
                        int bw = Math.max(60, Math.round(pw * scale));
                        int bh = Math.max(80, Math.round(ph * scale));
                        Bitmap bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888);
                        Canvas canvas = new Canvas(bmp);
                        canvas.drawColor(Color.WHITE);
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        ByteArrayOutputStream out = new ByteArrayOutputStream(16384);
                        bmp.compress(Bitmap.CompressFormat.JPEG, 74, out);
                        bmp.recycle();
                        byte[] jpeg = out.toByteArray();
                        if (jpeg.length > 100) info.coverJpeg = jpeg;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return info;
    }

    /**
     * Reads only the first ~32 uncompressed bytes of a ZIP entry directly from FileChannel
     * (used to self-calibrate `_names.list` tag indices and detect EPUB/PDF/Image/SQLite magic).
     */
    private static byte[] peekZipEntryHead(FileChannel ch, ZipCdEntry entry) {
        if (entry.compSize <= 0 || (entry.method != 0 && entry.method != 8)) return null;
        try {
            ByteBuffer lh = ByteBuffer.allocate(30).order(ByteOrder.LITTLE_ENDIAN);
            readFully(ch, entry.localHeaderOffset, lh);
            if (lh.remaining() < 30 || lh.getInt(0) != 0x04034b50) return null;
            int localNameLen = lh.getShort(26) & 0xffff;
            int localExtraLen = lh.getShort(28) & 0xffff;
            long dataOffset = entry.localHeaderOffset + 30L + localNameLen + localExtraLen;

            int peekComp = (int) Math.min(entry.compSize, 512L);
            byte[] comp = new byte[peekComp];
            ByteBuffer bb = ByteBuffer.wrap(comp);
            readFully(ch, dataOffset, bb);
            int got = bb.remaining();
            if (got <= 0) return null;

            if (entry.method == 0) {
                int outLen = Math.min(got, 32);
                byte[] res = new byte[outLen];
                System.arraycopy(comp, 0, res, 0, outLen);
                return res;
            }

            Inflater inf = new Inflater(true);
            try {
                inf.setInput(comp, 0, got);
                byte[] out = new byte[32];
                int n = inf.inflate(out);
                if (n <= 0) return null;
                byte[] res = new byte[n];
                System.arraycopy(out, 0, res, 0, n);
                return res;
            } finally {
                inf.end();
            }
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Map<String, String> parseMoonNamesListJava(
        String text,
        boolean hasZeroTag,
        FileChannel ch,
        List<ZipCdEntry> entries
    ) {
        Map<String, String> map = new HashMap<>();
        String[] rawLines = text.split("\\r?\\n");
        List<String> lines = new ArrayList<>();
        boolean hasExplicitPairs = false;
        for (String raw : rawLines) {
            String line = raw.trim();
            if (line.isEmpty()) continue;
            int eq = line.indexOf('=');
            if (eq > 0 && eq < 16) {
                String left = line.substring(0, eq).trim().toLowerCase(Locale.ROOT);
                if (left.matches("\\d+(\\.tag)?")) {
                    String key = left.endsWith(".tag") ? left : left + ".tag";
                    map.put(key, line.substring(eq + 1).trim());
                    hasExplicitPairs = true;
                    continue;
                }
            }
            lines.add(line);
        }
        if (hasExplicitPairs && lines.isEmpty()) {
            return map;
        }

        // Self-calibrate offset using mrbooks.db line index vs actual SQLite N.tag entry!
        int defaultOffset = hasZeroTag ? 0 : 1;
        int calibratedOffset = defaultOffset;
        int mrLineIdx = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).toLowerCase(Locale.ROOT).contains("mrbooks.db")) {
                mrLineIdx = i;
                break;
            }
        }
        if (mrLineIdx >= 0 && ch != null && entries != null) {
            for (ZipCdEntry e : entries) {
                int sl = e.name.lastIndexOf('/');
                String base = (sl >= 0 ? e.name.substring(sl + 1) : e.name).toLowerCase(Locale.ROOT);
                if (!base.endsWith(".tag")) continue;
                String numStr = base.substring(0, base.length() - 4);
                if (!numStr.matches("\\d+")) continue;
                byte[] head = peekZipEntryHead(ch, e);
                if (head != null && isSqliteHead(head, head.length)) {
                    int tagNum = Integer.parseInt(numStr);
                    int diff = tagNum - mrLineIdx;
                    if (diff >= -2 && diff <= 3) {
                        calibratedOffset = diff;
                        break;
                    }
                }
            }
        }

        for (int i = 0; i < lines.size(); i++) {
            int tagNum = i + calibratedOffset;
            if (tagNum >= 0) {
                map.put(tagNum + ".tag", lines.get(i));
            }
        }
        return map;
    }

    private static byte[] readZipEntryBytes(FileChannel ch, ZipCdEntry entry) throws IOException {
        if (entry.compSize < 0 || entry.compSize > MAX_SINGLE_META_ENTRY) return null;
        if (entry.uncompSize > MAX_SINGLE_META_ENTRY) return null;
        if (entry.method != 0 && entry.method != 8) return null;

        ByteBuffer lh = ByteBuffer.allocate(30).order(ByteOrder.LITTLE_ENDIAN);
        readFully(ch, entry.localHeaderOffset, lh);
        if (lh.remaining() < 30 || lh.getInt(0) != 0x04034b50) {
            return null;
        }
        int localNameLen = lh.getShort(26) & 0xffff;
        int localExtraLen = lh.getShort(28) & 0xffff;
        long dataOffset = entry.localHeaderOffset + 30L + localNameLen + localExtraLen;

        int compLen = (int) entry.compSize;
        byte[] compBytes = new byte[compLen];
        ByteBuffer dataBuf = ByteBuffer.wrap(compBytes);
        readFully(ch, dataOffset, dataBuf);
        if (dataBuf.remaining() < compLen) return null;

        if (entry.method == 0) {
            return compBytes;
        }

        Inflater inflater = new Inflater(true);
        try {
            inflater.setInput(compBytes);
            ByteArrayOutputStream baos = new ByteArrayOutputStream(
                (int) Math.min(Math.max(entry.uncompSize, 1024), 4 * 1024 * 1024)
            );
            byte[] outBuf = new byte[16384];
            long total = 0;
            while (!inflater.finished()) {
                int count = inflater.inflate(outBuf);
                if (count == 0) {
                    if (inflater.needsInput() || inflater.needsDictionary()) break;
                } else {
                    total += count;
                    if (total > MAX_SINGLE_META_ENTRY) return null;
                    baos.write(outBuf, 0, count);
                }
            }
            return baos.toByteArray();
        } catch (Exception e) {
            return null;
        } finally {
            inflater.end();
        }
    }

    /**
     * Streams a single large ZIP entry (e.g. an EPUB or PDF) from FileChannel directly to disk
     * using only a 64 KB buffer — ZERO large heap allocation!
     */
    private static boolean streamZipEntryToFile(
        FileChannel ch,
        ZipCdEntry entry,
        File destFile,
        long maxUncompBytes
    ) {
        if (entry.compSize <= 0 || entry.uncompSize > maxUncompBytes) return false;
        if (entry.method != 0 && entry.method != 8) return false;

        try {
            ByteBuffer lh = ByteBuffer.allocate(30).order(ByteOrder.LITTLE_ENDIAN);
            readFully(ch, entry.localHeaderOffset, lh);
            if (lh.remaining() < 30 || lh.getInt(0) != 0x04034b50) return false;
            int localNameLen = lh.getShort(26) & 0xffff;
            int localExtraLen = lh.getShort(28) & 0xffff;
            long dataOffset = entry.localHeaderOffset + 30L + localNameLen + localExtraLen;

            byte[] inArr = new byte[65536];
            ByteBuffer inBuf = ByteBuffer.wrap(inArr);
            long remaining = entry.compSize;
            long pos = dataOffset;

            if (entry.method == 0) {
                try (FileOutputStream fos = new FileOutputStream(destFile)) {
                    while (remaining > 0) {
                        int want = (int) Math.min(inArr.length, remaining);
                        inBuf.clear();
                        inBuf.limit(want);
                        int r = ch.read(inBuf, pos);
                        if (r <= 0) break;
                        fos.write(inArr, 0, r);
                        pos += r;
                        remaining -= r;
                    }
                }
                return destFile.length() > 64;
            }

            Inflater inflater = new Inflater(true);
            byte[] outArr = new byte[65536];
            long written = 0;
            try (FileOutputStream fos = new FileOutputStream(destFile)) {
                while (!inflater.finished()) {
                    if (inflater.needsInput()) {
                        if (remaining <= 0) break;
                        int want = (int) Math.min(inArr.length, remaining);
                        inBuf.clear();
                        inBuf.limit(want);
                        int r = ch.read(inBuf, pos);
                        if (r <= 0) break;
                        pos += r;
                        remaining -= r;
                        inflater.setInput(inArr, 0, r);
                    }
                    int count = inflater.inflate(outArr);
                    if (count > 0) {
                        written += count;
                        if (written > maxUncompBytes) return false;
                        fos.write(outArr, 0, count);
                    } else if (inflater.needsDictionary()) {
                        break;
                    }
                }
            } finally {
                inflater.end();
            }
            return written > 64;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static ExtractionStats extractZipMetadataViaChannel(
        FileChannel ch,
        long fileSize,
        File outZipFile,
        File scanFile,
        ProgressCallback progressCb
    ) throws IOException {
        int tailLen = (int) Math.min(fileSize, 65557L);
        long tailPos = fileSize - tailLen;
        ByteBuffer tailBuf = ByteBuffer.allocate(tailLen).order(ByteOrder.LITTLE_ENDIAN);
        readFully(ch, tailPos, tailBuf);
        byte[] tailBytes = tailBuf.array();

        int eocdIdx = -1;
        for (int i = tailLen - 22; i >= 0; i--) {
            if (
                tailBytes[i] == 0x50 &&
                tailBytes[i + 1] == 0x4b &&
                tailBytes[i + 2] == 0x05 &&
                tailBytes[i + 3] == 0x06
            ) {
                eocdIdx = i;
                break;
            }
        }
        if (eocdIdx < 0) {
            throw new IOException("No se encontró el directorio central del ZIP");
        }

        long cdSize = tailBuf.getInt(eocdIdx + 12) & 0xFFFFFFFFL;
        long cdOffset = tailBuf.getInt(eocdIdx + 16) & 0xFFFFFFFFL;
        long eocdAbsPos = tailPos + eocdIdx;

        // Handle ZIP64 End of Central Directory (for backups > 4 GB or > 65535 entries)
        if ((cdSize == 0xFFFFFFFFL || cdOffset == 0xFFFFFFFFL) && eocdAbsPos >= 20) {
            ByteBuffer locBuf = ByteBuffer.allocate(20).order(ByteOrder.LITTLE_ENDIAN);
            readFully(ch, eocdAbsPos - 20L, locBuf);
            if (locBuf.remaining() == 20 && locBuf.getInt(0) == 0x07064b50) {
                long z64EocdOffset = locBuf.getLong(8);
                ByteBuffer z64Buf = ByteBuffer.allocate(56).order(ByteOrder.LITTLE_ENDIAN);
                readFully(ch, z64EocdOffset, z64Buf);
                if (z64Buf.remaining() == 56 && z64Buf.getInt(0) == 0x06064b50) {
                    cdSize = z64Buf.getLong(40);
                    cdOffset = z64Buf.getLong(48);
                }
            }
        }

        if (cdSize <= 0 || cdSize > 64L * 1024L * 1024L || cdOffset < 0 || cdOffset + cdSize > fileSize) {
            throw new IOException("Directorio central ZIP fuera de rango");
        }

        ByteBuffer cdBuf = ByteBuffer.allocate((int) cdSize).order(ByteOrder.LITTLE_ENDIAN);
        readFully(ch, cdOffset, cdBuf);
        byte[] cdBytes = cdBuf.array();

        List<ZipCdEntry> entries = new ArrayList<>();
        int p = 0;
        while (p + 46 <= cdBytes.length) {
            if (cdBuf.getInt(p) != 0x02014b50) break;
            int method = cdBuf.getShort(p + 10) & 0xffff;
            long compSize = cdBuf.getInt(p + 20) & 0xFFFFFFFFL;
            long uncompSize = cdBuf.getInt(p + 24) & 0xFFFFFFFFL;
            int nameLen = cdBuf.getShort(p + 28) & 0xffff;
            int extraLen = cdBuf.getShort(p + 30) & 0xffff;
            int commentLen = cdBuf.getShort(p + 32) & 0xffff;
            long localOffset = cdBuf.getInt(p + 42) & 0xFFFFFFFFL;

            if (p + 46 + nameLen > cdBytes.length) break;
            String name = new String(cdBytes, p + 46, nameLen, StandardCharsets.UTF_8);

            if (
                (uncompSize == 0xFFFFFFFFL || compSize == 0xFFFFFFFFL || localOffset == 0xFFFFFFFFL) &&
                extraLen >= 4
            ) {
                int ep = p + 46 + nameLen;
                int extraEnd = Math.min(cdBytes.length, ep + extraLen);
                while (ep + 4 <= extraEnd) {
                    int headerId = cdBuf.getShort(ep) & 0xffff;
                    int dataSize = cdBuf.getShort(ep + 2) & 0xffff;
                    ep += 4;
                    if (headerId == 0x0001 && ep + dataSize <= extraEnd) {
                        int fp = ep;
                        if (uncompSize == 0xFFFFFFFFL && fp + 8 <= ep + dataSize) {
                            uncompSize = cdBuf.getLong(fp);
                            fp += 8;
                        }
                        if (compSize == 0xFFFFFFFFL && fp + 8 <= ep + dataSize) {
                            compSize = cdBuf.getLong(fp);
                            fp += 8;
                        }
                        if (localOffset == 0xFFFFFFFFL && fp + 8 <= ep + dataSize) {
                            localOffset = cdBuf.getLong(fp);
                        }
                        break;
                    }
                    ep += dataSize;
                }
            }

            if (!name.endsWith("/")) {
                ZipCdEntry e = new ZipCdEntry();
                e.name = name;
                e.method = method;
                e.compSize = compSize;
                e.uncompSize = uncompSize;
                e.localHeaderOffset = localOffset;
                entries.add(e);
            }
            p += 46 + nameLen + extraLen + commentLen;
        }

        // Pass 1: Detect Moon+ Reader `_names.list`
        ZipCdEntry namesListEntry = null;
        boolean hasZeroTag = false;
        for (ZipCdEntry e : entries) {
            String low = e.name.toLowerCase(Locale.ROOT);
            if (low.equals("_names.list") || low.endsWith("/_names.list")) {
                namesListEntry = e;
            }
            if (low.equals("0.tag") || low.endsWith("/0.tag")) {
                hasZeroTag = true;
            }
        }

        Map<String, String> tagToRealPath = new HashMap<>();
        byte[] namesListBytes = null;
        if (namesListEntry != null) {
            namesListBytes = readZipEntryBytes(ch, namesListEntry);
            if (namesListBytes != null) {
                String listText = new String(namesListBytes, StandardCharsets.UTF_8);
                tagToRealPath = parseMoonNamesListJava(listText, hasZeroTag, ch, entries);
            }
        }

        // Classify entries: metadata, cover thumbnails (.tn/.jpg/.png/.webp), and EPUB/PDF books
        List<ZipCdEntry> epubPdfEntries = new ArrayList<>();
        List<ZipCdEntry> coverImgEntries = new ArrayList<>();
        List<ZipCdEntry> metaEntries = new ArrayList<>();
        ExtractionStats stats = new ExtractionStats();

        for (ZipCdEntry e : entries) {
            if (e == namesListEntry) continue;
            int slash = e.name.lastIndexOf('/');
            String baseName = (slash >= 0 ? e.name.substring(slash + 1) : e.name).toLowerCase(Locale.ROOT);
            String effective = tagToRealPath.containsKey(baseName) ? tagToRealPath.get(baseName) : e.name;
            String lowerEff = effective.toLowerCase(Locale.ROOT);

            if (isEpubName(lowerEff) && e.uncompSize <= MAX_EPUB_SCAN_BYTES) {
                epubPdfEntries.add(e);
                continue;
            }
            if (isPdfName(lowerEff) && e.uncompSize <= MAX_PDF_SCAN_BYTES) {
                epubPdfEntries.add(e);
                continue;
            }
            if (isCoverImagePath(lowerEff) && e.uncompSize <= MAX_THUMB_IMG_BYTES) {
                coverImgEntries.add(e);
                continue;
            }
            if (
                e.uncompSize > MAX_SINGLE_META_ENTRY ||
                e.compSize > MAX_SINGLE_META_ENTRY ||
                isHeavyMediaOrOtherBookName(lowerEff) ||
                isImageFileName(lowerEff)
            ) {
                stats.skippedCount++;
                continue;
            }

            boolean wantByName = isMetadataName(lowerEff);
            if (!wantByName && baseName.endsWith(".tag")) {
                // Magic-byte fallback for .tag entries with unknown/non-standard extensions (e.g. Moon+ cache covers or books)
                byte[] head = peekZipEntryHead(ch, e);
                if (head != null) {
                    if (isImageMagic(head, head.length) && e.uncompSize <= MAX_THUMB_IMG_BYTES) {
                        coverImgEntries.add(e);
                        continue;
                    }
                    if (isPdfMagicHead(head, head.length) && e.uncompSize <= MAX_PDF_SCAN_BYTES) {
                        epubPdfEntries.add(e);
                        continue;
                    }
                    if (isZipMagicHead(head, head.length) && e.uncompSize <= MAX_EPUB_SCAN_BYTES) {
                        epubPdfEntries.add(e);
                        continue;
                    }
                    if (isSqliteHead(head, head.length)) {
                        metaEntries.add(e);
                        continue;
                    }
                }
            }
            if (namesListEntry != null && tagToRealPath.containsKey(baseName) && !wantByName) {
                stats.skippedCount++;
                continue;
            }
            if (!wantByName && e.uncompSize > 4L * 1024L * 1024L) {
                stats.skippedCount++;
                continue;
            }
            metaEntries.add(e);
        }

        stats.thumbsFoundCount = coverImgEntries.size();
        stats.booksScannedCount = epubPdfEntries.size();

        JSONArray extractedBooksArr = new JSONArray();
        JSONArray extractedThumbsArr = new JSONArray();
        long totalWritten = 0;
        Set<String> writtenEntryNames = new HashSet<>();

        try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(outZipFile))) {
            zos.setLevel(1);

            if (namesListEntry != null && namesListBytes != null && writtenEntryNames.add(namesListEntry.name)) {
                zos.putNextEntry(new ZipEntry(namesListEntry.name));
                zos.write(namesListBytes);
                zos.closeEntry();
                totalWritten += namesListBytes.length;
                stats.keptCount++;
            }

            // 1. Write database & text metadata files (mrbooks.db, .po, .xml, etc.)
            for (ZipCdEntry e : metaEntries) {
                if (totalWritten + Math.max(0, e.uncompSize) > MAX_TOTAL_META_BYTES) {
                    stats.skippedCount++;
                    continue;
                }
                if (!writtenEntryNames.add(e.name)) {
                    stats.skippedCount++;
                    continue;
                }
                byte[] data = readZipEntryBytes(ch, e);
                if (data == null || data.length == 0) continue;

                int slash = e.name.lastIndexOf('/');
                String baseName = (slash >= 0 ? e.name.substring(slash + 1) : e.name).toLowerCase(Locale.ROOT);
                String effective = tagToRealPath.containsKey(baseName) ? tagToRealPath.get(baseName) : e.name;
                String lowerEff = effective.toLowerCase(Locale.ROOT);
                if (!isMetadataName(lowerEff) && !isSqliteHead(data, data.length) && isHeavyBinaryHead(data, data.length)) {
                    stats.skippedCount++;
                    continue;
                }

                zos.putNextEntry(new ZipEntry(e.name));
                zos.write(data);
                zos.closeEntry();
                totalWritten += data.length;
                stats.keptCount++;
            }

            // 2. Extract Moon+ Reader cached cover thumbnails (Cache/*.jpg, *.png, *.tn, etc.)
            int thumbIdx = 0;
            if (!coverImgEntries.isEmpty() && progressCb != null) {
                progressCb.onMessage("Extrayendo portadas en caché (" + coverImgEntries.size() + ")...");
            }
            for (ZipCdEntry e : coverImgEntries) {
                if (stats.coversCount >= MAX_COVERS_EXTRACTED || totalWritten >= MAX_TOTAL_META_BYTES) {
                    stats.skippedCount++;
                    continue;
                }
                byte[] rawImg = readZipEntryBytes(ch, e);
                byte[] thumbJpeg = compressImageToThumbnailJpeg(rawImg);
                if (thumbJpeg == null) continue;

                int slash = e.name.lastIndexOf('/');
                String baseName = (slash >= 0 ? e.name.substring(slash + 1) : e.name).toLowerCase(Locale.ROOT);
                String effective = tagToRealPath.containsKey(baseName) ? tagToRealPath.get(baseName) : e.name;
                String coverEntryName = "__komo_covers__/thumb_" + (++thumbIdx) + ".jpg";
                writtenEntryNames.add(coverEntryName);

                zos.putNextEntry(new ZipEntry(coverEntryName));
                zos.write(thumbJpeg);
                zos.closeEntry();
                totalWritten += thumbJpeg.length;
                stats.coversCount++;
                stats.keptCount++;

                try {
                    JSONObject item = new JSONObject();
                    item.put("realPath", effective);
                    item.put("entryName", e.name);
                    item.put("coverEntry", coverEntryName);
                    extractedThumbsArr.put(item);
                } catch (Exception ignored) {
                }
            }

            // 3. Inspect embedded EPUB & PDF books 1-by-1 on disk for real Authors, Titles & Original Covers!
            int totalBooksToScan = epubPdfEntries.size();
            int bookIdx = 0;
            for (ZipCdEntry e : epubPdfEntries) {
                bookIdx++;
                if (progressCb != null && (bookIdx == 1 || bookIdx % 5 == 0 || bookIdx == totalBooksToScan)) {
                    progressCb.onMessage(
                        "Leyendo autores y portadas originales (" + bookIdx + "/" + totalBooksToScan + ")..."
                    );
                }

                int slash = e.name.lastIndexOf('/');
                String baseName = (slash >= 0 ? e.name.substring(slash + 1) : e.name).toLowerCase(Locale.ROOT);
                String effective = tagToRealPath.containsKey(baseName) ? tagToRealPath.get(baseName) : e.name;
                String lowerEff = effective.toLowerCase(Locale.ROOT);

                boolean isPdf = isPdfName(lowerEff);
                if (!isPdf && !isEpubName(lowerEff)) {
                    byte[] h = peekZipEntryHead(ch, e);
                    if (h != null && isPdfMagicHead(h, h.length)) isPdf = true;
                }
                boolean isEpub = !isPdf;
                long cap = isEpub ? MAX_EPUB_SCAN_BYTES : MAX_PDF_SCAN_BYTES;

                if (scanFile.exists()) scanFile.delete();
                boolean extractedOk = streamZipEntryToFile(ch, e, scanFile, cap);
                stats.skippedCount++; // Original heavy book binary is not copied to JS
                if (!extractedOk) continue;

                ExtractedBookInfo info = isEpub ? inspectEpubFile(scanFile) : inspectPdfFile(scanFile);
                if (scanFile.exists()) scanFile.delete();

                String coverEntryName = null;
                if (
                    info.coverJpeg != null &&
                    stats.coversCount < MAX_COVERS_EXTRACTED &&
                    totalWritten + info.coverJpeg.length < MAX_TOTAL_META_BYTES
                ) {
                    coverEntryName = "__komo_covers__/book_" + bookIdx + ".jpg";
                    writtenEntryNames.add(coverEntryName);
                    zos.putNextEntry(new ZipEntry(coverEntryName));
                    zos.write(info.coverJpeg);
                    zos.closeEntry();
                    totalWritten += info.coverJpeg.length;
                    stats.coversCount++;
                    stats.keptCount++;
                }

                try {
                    JSONObject obj = new JSONObject();
                    obj.put("realPath", effective);
                    obj.put("entryName", e.name);
                    int effSlash = Math.max(effective.lastIndexOf('/'), effective.lastIndexOf('\\'));
                    obj.put("fileName", effSlash >= 0 ? effective.substring(effSlash + 1) : effective);
                    obj.put("format", info.format);
                    if (info.title != null && !info.title.isEmpty()) obj.put("title", info.title);
                    if (info.author != null && !info.author.isEmpty()) obj.put("author", info.author);
                    if (info.description != null && !info.description.isEmpty()) obj.put("description", info.description);
                    if (info.pageCount > 0) obj.put("pageCount", info.pageCount);
                    if (coverEntryName != null) obj.put("coverEntry", coverEntryName);
                    extractedBooksArr.put(obj);
                } catch (Exception ignored) {
                }
            }

            // 4. Write combined extracted metadata manifest (including calibrated tagMap!) for TypeScript parser
            try {
                JSONObject manifest = new JSONObject();
                manifest.put("books", extractedBooksArr);
                manifest.put("thumbs", extractedThumbsArr);
                if (!tagToRealPath.isEmpty()) {
                    JSONObject tagMapJson = new JSONObject();
                    for (Map.Entry<String, String> entry : tagToRealPath.entrySet()) {
                        tagMapJson.put(entry.getKey(), entry.getValue());
                    }
                    manifest.put("tagMap", tagMapJson);
                }
                manifest.put("mode", "channel");
                byte[] manifestBytes = manifest.toString().getBytes(StandardCharsets.UTF_8);
                zos.putNextEntry(new ZipEntry("__komo_extracted_meta__.json"));
                zos.write(manifestBytes);
                zos.closeEntry();
                stats.keptCount++;
            } catch (Exception ignored) {
            }
        }
        return stats;
    }

    private static ExtractionStats extractZipMetadataViaStream(
        InputStream in,
        File outZipFile,
        File scanFile,
        ProgressCallback progressCb
    ) throws IOException {
        ExtractionStats stats = new ExtractionStats();
        long totalWritten = 0;
        byte[] buf = new byte[65536];
        JSONArray extractedBooksArr = new JSONArray();
        JSONArray extractedThumbsArr = new JSONArray();
        Set<String> writtenEntryNames = new HashSet<>();
        int bookIdx = 0;
        int thumbIdx = 0;
        boolean seenZeroTag = false;
        String namesListText = null;
        int sqliteTagNum = -1;

        try (
            ZipInputStream zis = new ZipInputStream(in);
            ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(outZipFile))
        ) {
            zos.setLevel(1);
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    zis.closeEntry();
                    continue;
                }
                String name = entry.getName();
                String lower = name.toLowerCase(Locale.ROOT);
                long knownSize = entry.getSize();
                if (lower.equals("0.tag") || lower.endsWith("/0.tag")) {
                    seenZeroTag = true;
                }

                if (isHeavyMediaOrOtherBookName(lower) || totalWritten >= MAX_TOTAL_META_BYTES) {
                    stats.skippedCount++;
                    zis.closeEntry();
                    continue;
                }

                // Read first chunk to inspect magic bytes
                int r = zis.read(buf, 0, Math.min(buf.length, 4096));
                if (r <= 0) {
                    zis.closeEntry();
                    continue;
                }
                byte[] head = new byte[r];
                System.arraycopy(buf, 0, head, 0, r);

                boolean looksEpub = isEpubName(lower) || (isZipMagicHead(head, head.length) && !isMetadataName(lower));
                boolean looksPdf = isPdfName(lower) || isPdfMagicHead(head, head.length);
                boolean looksImg = isImageFileName(lower) || isImageMagic(head, head.length);

                if (looksEpub || looksPdf) {
                    long cap = looksEpub ? MAX_EPUB_SCAN_BYTES : MAX_PDF_SCAN_BYTES;
                    if (scanFile.exists()) scanFile.delete();
                    long written = 0;
                    boolean ok = true;
                    try (FileOutputStream fos = new FileOutputStream(scanFile)) {
                        fos.write(head);
                        written = head.length;
                        while ((r = zis.read(buf)) != -1) {
                            written += r;
                            if (written <= cap) {
                                fos.write(buf, 0, r);
                            } else {
                                ok = false;
                            }
                        }
                    }
                    stats.skippedCount++;
                    if (ok && written > 64) {
                        bookIdx++;
                        stats.booksScannedCount++;
                        if (progressCb != null && (bookIdx == 1 || bookIdx % 5 == 0)) {
                            progressCb.onMessage("Leyendo autores y portadas (" + bookIdx + ")...");
                        }
                        ExtractedBookInfo info = looksEpub ? inspectEpubFile(scanFile) : inspectPdfFile(scanFile);
                        if (scanFile.exists()) scanFile.delete();

                        if (info.title != null || info.author != null || info.coverJpeg != null) {
                            String coverEntryName = null;
                            if (
                                info.coverJpeg != null &&
                                stats.coversCount < MAX_COVERS_EXTRACTED &&
                                totalWritten + info.coverJpeg.length < MAX_TOTAL_META_BYTES
                            ) {
                                coverEntryName = "__komo_covers__/book_" + bookIdx + ".jpg";
                                zos.putNextEntry(new ZipEntry(coverEntryName));
                                zos.write(info.coverJpeg);
                                zos.closeEntry();
                                totalWritten += info.coverJpeg.length;
                                stats.coversCount++;
                                stats.keptCount++;
                            }
                            try {
                                JSONObject obj = new JSONObject();
                                obj.put("realPath", name);
                                obj.put("entryName", name);
                                int effSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
                                obj.put("fileName", effSlash >= 0 ? name.substring(effSlash + 1) : name);
                                obj.put("format", info.format);
                                if (info.title != null && !info.title.isEmpty()) obj.put("title", info.title);
                                if (info.author != null && !info.author.isEmpty()) obj.put("author", info.author);
                                if (info.description != null && !info.description.isEmpty()) obj.put("description", info.description);
                                if (info.pageCount > 0) obj.put("pageCount", info.pageCount);
                                if (coverEntryName != null) obj.put("coverEntry", coverEntryName);
                                extractedBooksArr.put(obj);
                            } catch (Exception ignored) {
                            }
                        }
                    }
                    zis.closeEntry();
                    continue;
                }

                if (looksImg && stats.coversCount < MAX_COVERS_EXTRACTED) {
                    ByteArrayOutputStream imgBuf = new ByteArrayOutputStream();
                    imgBuf.write(head);
                    long sz = head.length;
                    boolean tooBig = false;
                    while ((r = zis.read(buf)) != -1) {
                        sz += r;
                        if (sz > MAX_THUMB_IMG_BYTES) {
                            tooBig = true;
                            break;
                        }
                        imgBuf.write(buf, 0, r);
                    }
                    if (!tooBig) {
                        byte[] thumbJpeg = compressImageToThumbnailJpeg(imgBuf.toByteArray());
                        if (thumbJpeg != null && totalWritten + thumbJpeg.length < MAX_TOTAL_META_BYTES) {
                            String coverEntryName = "__komo_covers__/thumb_" + (++thumbIdx) + ".jpg";
                            writtenEntryNames.add(coverEntryName);
                            zos.putNextEntry(new ZipEntry(coverEntryName));
                            zos.write(thumbJpeg);
                            zos.closeEntry();
                            totalWritten += thumbJpeg.length;
                            stats.coversCount++;
                            stats.thumbsFoundCount++;
                            stats.keptCount++;
                            try {
                                JSONObject item = new JSONObject();
                                item.put("realPath", name);
                                item.put("entryName", name);
                                item.put("coverEntry", coverEntryName);
                                extractedThumbsArr.put(item);
                            } catch (Exception ignored) {
                            }
                        }
                    } else {
                        stats.skippedCount++;
                    }
                    zis.closeEntry();
                    continue;
                }

                boolean explicitMeta = isMetadataName(lower) || isSqliteHead(head, head.length);
                if (!explicitMeta && isHeavyBinaryHead(head, head.length)) {
                    stats.skippedCount++;
                    zis.closeEntry();
                    continue;
                }

                long cap = explicitMeta ? MAX_SINGLE_META_ENTRY : 4L * 1024L * 1024L;
                if (knownSize > cap) {
                    stats.skippedCount++;
                    zis.closeEntry();
                    continue;
                }

                ByteArrayOutputStream entryBuf = new ByteArrayOutputStream();
                entryBuf.write(head);
                long entrySize = head.length;
                boolean tooBig = false;

                while ((r = zis.read(buf)) != -1) {
                    entrySize += r;
                    if (entrySize > cap || totalWritten + entrySize > MAX_TOTAL_META_BYTES) {
                        tooBig = true;
                        break;
                    }
                    entryBuf.write(buf, 0, r);
                }

                if (tooBig) {
                    stats.skippedCount++;
                } else {
                    byte[] payload = entryBuf.toByteArray();
                    if (lower.equals("_names.list") || lower.endsWith("/_names.list")) {
                        namesListText = new String(payload, StandardCharsets.UTF_8);
                    }
                    if (isSqliteHead(payload, payload.length)) {
                        int sl = lower.lastIndexOf('/');
                        String base = sl >= 0 ? lower.substring(sl + 1) : lower;
                        if (base.endsWith(".tag")) {
                            String numStr = base.substring(0, base.length() - 4);
                            if (numStr.matches("\\d+")) {
                                sqliteTagNum = Integer.parseInt(numStr);
                            }
                        }
                    }
                    if (writtenEntryNames.add(name)) {
                        zos.putNextEntry(new ZipEntry(name));
                        zos.write(payload);
                        zos.closeEntry();
                        totalWritten += payload.length;
                        stats.keptCount++;
                    }
                }
                zis.closeEntry();
            }

            try {
                JSONObject manifest = new JSONObject();
                manifest.put("books", extractedBooksArr);
                manifest.put("thumbs", extractedThumbsArr);
                manifest.put("mode", "stream");
                if (namesListText != null) {
                    Map<String, String> streamMap = parseMoonNamesListJava(namesListText, seenZeroTag, null, null);
                    // Calibrate streamMap using sqliteTagNum vs mrbooks.db line if found!
                    if (sqliteTagNum >= 0) {
                        String[] rawLines = namesListText.split("\\r?\\n");
                        List<String> nonEmpty = new ArrayList<>();
                        for (String rl : rawLines) {
                            String t = rl.trim();
                            if (!t.isEmpty()) nonEmpty.add(t);
                        }
                        int mrIdx = -1;
                        for (int i = 0; i < nonEmpty.size(); i++) {
                            if (nonEmpty.get(i).toLowerCase(Locale.ROOT).contains("mrbooks.db")) {
                                mrIdx = i;
                                break;
                            }
                        }
                        if (mrIdx >= 0) {
                            int diff = sqliteTagNum - mrIdx;
                            if (diff >= -2 && diff <= 3) {
                                streamMap = new HashMap<>();
                                for (int i = 0; i < nonEmpty.size(); i++) {
                                    int tn = i + diff;
                                    if (tn >= 0) streamMap.put(tn + ".tag", nonEmpty.get(i));
                                }
                            }
                        }
                    }
                    if (!streamMap.isEmpty()) {
                        JSONObject tagMapJson = new JSONObject();
                        for (Map.Entry<String, String> entryMap : streamMap.entrySet()) {
                            tagMapJson.put(entryMap.getKey(), entryMap.getValue());
                        }
                        manifest.put("tagMap", tagMapJson);
                    }
                }
                byte[] manifestBytes = manifest.toString().getBytes(StandardCharsets.UTF_8);
                zos.putNextEntry(new ZipEntry("__komo_extracted_meta__.json"));
                zos.write(manifestBytes);
                zos.closeEntry();
                stats.keptCount++;
            } catch (Exception ignored) {
            }
        }
        return stats;
    }

    private static class FolderBookCandidate {
        Uri uri;
        String fileName;
        String folderPath;
        String mimeType;
        String format;
        long size;
    }

    private static String detectLibraryFormatJava(String fileName, String mimeType) {
        if (fileName == null) return null;
        String low = fileName.toLowerCase(Locale.ROOT);
        if (low.startsWith(".")) return null;
        if (low.endsWith(".epub")) return "epub";
        if (low.endsWith(".pdf")) return "pdf";
        if (low.endsWith(".cbz") || low.endsWith(".zip")) return "cbz";
        if (low.endsWith(".cbr") || low.endsWith(".rar")) return "cbr";
        if (low.endsWith(".fb2")) return "fb2";
        if (low.endsWith(".mobi") || low.endsWith(".prc") || low.endsWith(".azw")) return "mobi";
        if (low.endsWith(".azw3")) return "azw3";
        if (low.endsWith(".docx")) return "docx";
        if (low.endsWith(".md") || low.endsWith(".markdown")) return "md";
        if (low.endsWith(".html") || low.endsWith(".htm")) return "html";
        if (low.endsWith(".txt")) return "txt";
        if (
            low.endsWith(".mp3") ||
            low.endsWith(".m4b") ||
            low.endsWith(".m4a") ||
            low.endsWith(".aac") ||
            low.endsWith(".ogg") ||
            low.endsWith(".oga") ||
            low.endsWith(".opus") ||
            low.endsWith(".wav") ||
            low.endsWith(".flac") ||
            low.endsWith(".webm") ||
            low.endsWith(".wma") ||
            low.endsWith(".amr") ||
            low.endsWith(".3gp") ||
            low.endsWith(".aif") ||
            low.endsWith(".aiff") ||
            low.endsWith(".caf") ||
            low.endsWith(".alac") ||
            low.endsWith(".ac3") ||
            low.endsWith(".mp2") ||
            low.endsWith(".mka") ||
            (mimeType != null && mimeType.startsWith("audio/"))
        ) {
            return "audio";
        }
        return null;
    }

    private static ExtractedBookInfo inspectCbzFile(File cbzFile) {
        ExtractedBookInfo info = new ExtractedBookInfo();
        info.format = "cbz";
        try (ZipFile zf = new ZipFile(cbzFile)) {
            List<ZipEntry> imgs = new ArrayList<>();
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                if (e.isDirectory()) continue;
                String name = e.getName();
                if (name.startsWith("__MACOSX")) continue;
                int sl = name.lastIndexOf('/');
                String base = sl >= 0 ? name.substring(sl + 1) : name;
                if (base.startsWith(".")) continue;
                String low = base.toLowerCase(Locale.ROOT);
                if (
                    low.endsWith(".jpg") ||
                    low.endsWith(".jpeg") ||
                    low.endsWith(".png") ||
                    low.endsWith(".webp") ||
                    low.endsWith(".bmp")
                ) {
                    imgs.add(e);
                }
            }
            info.pageCount = imgs.size();
            if (!imgs.isEmpty()) {
                imgs.sort((a, b) -> a.getName().compareToIgnoreCase(b.getName()));
                ZipEntry pick = imgs.get(0);
                for (ZipEntry img : imgs) {
                    String bLow = img.getName().toLowerCase(Locale.ROOT);
                    if (bLow.contains("cover") || bLow.contains("portada") || bLow.contains("front")) {
                        pick = img;
                        break;
                    }
                }
                if (pick.getSize() < 0 || pick.getSize() <= MAX_THUMB_IMG_BYTES) {
                    try (InputStream is = zf.getInputStream(pick)) {
                        byte[] raw = readAllLimited(is, (int) MAX_THUMB_IMG_BYTES);
                        info.coverJpeg = compressImageToThumbnailJpeg(raw);
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return info;
    }

    private void emitFolderStatus(String message, int processed, int total, int coversFound) {
        JSONObject p = new JSONObject();
        try {
            if (message != null) p.put("message", message);
            p.put("processed", processed);
            p.put("total", total);
            p.put("coversFound", coversFound);
        } catch (Exception ignored) {
        }
        emitJsCallback("__komoNativeFolderStatus", p);
    }

    private void launchLibraryFolderPicker() {
        runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION |
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
                );
                folderPickerLauncher.launch(intent);
            } catch (Exception e) {
                JSONObject err = new JSONObject();
                try {
                    err.put("ok", false);
                    err.put("error", e.getMessage() != null ? e.getMessage() : "No se pudo abrir el selector de carpetas");
                } catch (Exception ignored) {
                }
                emitJsCallback("__komoNativeFolderDone", err);
            }
        });
    }

    private void collectFolderBooksRecursive(
        ContentResolver resolver,
        Uri treeUri,
        String parentDocId,
        String currentFolderPath,
        List<FolderBookCandidate> outList,
        int[] skippedRef,
        int depth
    ) {
        if (depth > 14) return;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
        };

        try (Cursor c = resolver.query(childrenUri, projection, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String docId = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                long size = c.isNull(3) ? 0L : c.getLong(3);
                if (docId == null || name == null || name.isEmpty() || name.startsWith(".")) {
                    continue;
                }
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (name.equalsIgnoreCase("__MACOSX") || name.equalsIgnoreCase("Android")) continue;
                    String nextPath = currentFolderPath.isEmpty() ? name : currentFolderPath + "/" + name;
                    collectFolderBooksRecursive(resolver, treeUri, docId, nextPath, outList, skippedRef, depth + 1);
                } else {
                    String fmt = detectLibraryFormatJava(name, mime);
                    if (fmt != null && size > 0) {
                        FolderBookCandidate item = new FolderBookCandidate();
                        item.uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                        item.fileName = name;
                        item.folderPath = currentFolderPath;
                        item.mimeType = (mime != null && !mime.isEmpty()) ? mime : "application/octet-stream";
                        item.format = fmt;
                        item.size = size;
                        outList.add(item);
                        if (outList.size() % 100 == 0) {
                            emitFolderStatus("Buscando libros en la carpeta (" + outList.size() + " encontrados)...", 0, outList.size(), 0);
                        }
                    } else {
                        skippedRef[0]++;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private boolean copyUriToTempFile(ContentResolver resolver, Uri uri, File dest, long maxBytes) {
        if (dest.exists()) dest.delete();
        try (InputStream is = resolver.openInputStream(uri); FileOutputStream fos = new FileOutputStream(dest)) {
            if (is == null) return false;
            byte[] buf = new byte[65536];
            long total = 0;
            int r;
            while ((r = is.read(buf)) != -1) {
                total += r;
                if (total > maxBytes) {
                    return false;
                }
                fos.write(buf, 0, r);
            }
            return total > 64;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private void processLibraryFolderUri(Uri treeUri) {
        processLibraryFolderUri(treeUri, null, null);
    }

    private static String normalizeFolderFileKey(String raw) {
        if (raw == null) return "";
        String base = raw;
        int slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
        if (slash >= 0) base = base.substring(slash + 1);
        int dot = base.lastIndexOf('.');
        if (dot > 0) base = base.substring(0, dot);
        String n = java.text.Normalizer.normalize(base, java.text.Normalizer.Form.NFD)
            .replaceAll("[\\p{InCombiningDiacriticalMarks}]+", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", " ")
            .trim();
        return n;
    }

    private void processLibraryFolderUri(Uri treeUri, Set<String> skipUris, Set<String> skipNormalizedNames) {
        new Thread(() -> {
            File scanTmp = new File(new File(getCacheDir(), "backup_import"), "komo_folder_scan.tmp");
            if (scanTmp.getParentFile() != null && !scanTmp.getParentFile().exists()) {
                scanTmp.getParentFile().mkdirs();
            }

            try {
                ContentResolver resolver = getContentResolver();
                try {
                    resolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) {
                }

                String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
                String rootFolderName = "";
                try {
                    Uri rootDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId);
                    try (Cursor rc = resolver.query(rootDocUri, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
                        if (rc != null && rc.moveToFirst()) {
                            rootFolderName = rc.getString(0) != null ? rc.getString(0) : "";
                        }
                    }
                } catch (Exception ignored) {
                }
                if (rootFolderName.isEmpty() && rootDocId != null) {
                    int idx = Math.max(rootDocId.lastIndexOf('/'), rootDocId.lastIndexOf(':'));
                    rootFolderName = idx >= 0 ? rootDocId.substring(idx + 1) : rootDocId;
                }

                emitFolderStatus("Escaneando subcarpetas de \"" + (rootFolderName.isEmpty() ? "Carpeta" : rootFolderName) + "\"...", 0, 0, 0);

                List<FolderBookCandidate> allCandidates = new ArrayList<>();
                int[] skippedRef = new int[] { 0 };
                collectFolderBooksRecursive(resolver, treeUri, rootDocId, rootFolderName, allCandidates, skippedRef, 0);

                List<FolderBookCandidate> candidates = new ArrayList<>();
                if ((skipUris != null && !skipUris.isEmpty()) || (skipNormalizedNames != null && !skipNormalizedNames.isEmpty())) {
                    for (FolderBookCandidate c : allCandidates) {
                        String uStr = c.uri.toString();
                        String fKey = normalizeFolderFileKey(c.fileName);
                        if ((skipUris != null && skipUris.contains(uStr)) ||
                            (skipNormalizedNames != null && !fKey.isEmpty() && skipNormalizedNames.contains(fKey))) {
                            skippedRef[0]++;
                            continue;
                        }
                        candidates.add(c);
                    }
                } else {
                    candidates = allCandidates;
                }

                int total = candidates.size();
                if (total > 0) {
                    emitFolderStatus("Encontrados " + total + " archivos nuevos. Leyendo portadas y metadatos...", 0, total, 0);
                }

                JSONArray batchArr = new JSONArray();
                int processed = 0;
                int coversFound = 0;
                int batchSize = 20;

                for (FolderBookCandidate cand : candidates) {
                    processed++;
                    ExtractedBookInfo info = null;
                    try {
                        if ("epub".equals(cand.format) && cand.size <= MAX_EPUB_SCAN_BYTES) {
                            if (copyUriToTempFile(resolver, cand.uri, scanTmp, MAX_EPUB_SCAN_BYTES)) {
                                info = inspectEpubFile(scanTmp);
                            }
                        } else if ("pdf".equals(cand.format) && cand.size <= MAX_PDF_SCAN_BYTES) {
                            if (copyUriToTempFile(resolver, cand.uri, scanTmp, MAX_PDF_SCAN_BYTES)) {
                                info = inspectPdfFile(scanTmp);
                            }
                        } else if ("cbz".equals(cand.format) && cand.size <= MAX_PDF_SCAN_BYTES) {
                            if (copyUriToTempFile(resolver, cand.uri, scanTmp, MAX_PDF_SCAN_BYTES)) {
                                info = inspectCbzFile(scanTmp);
                            }
                        }
                    } catch (Throwable ignored) {
                    } finally {
                        if (scanTmp.exists()) scanTmp.delete();
                    }

                    try {
                        JSONObject item = new JSONObject();
                        item.put("uri", cand.uri.toString());
                        item.put("fileName", cand.fileName);
                        if (cand.folderPath != null && !cand.folderPath.isEmpty()) {
                            item.put("folderPath", cand.folderPath);
                        }
                        item.put("fileSize", cand.size);
                        item.put("mimeType", cand.mimeType);
                        item.put("format", cand.format);
                        if (info != null) {
                            if (info.title != null && !info.title.isEmpty()) item.put("title", info.title);
                            if (info.author != null && !info.author.isEmpty()) item.put("author", info.author);
                            if (info.description != null && !info.description.isEmpty()) item.put("description", info.description);
                            if (info.pageCount > 0) item.put("pageCount", info.pageCount);
                            if (info.coverJpeg != null && info.coverJpeg.length > 100) {
                                item.put("coverBase64", Base64.encodeToString(info.coverJpeg, Base64.NO_WRAP));
                                coversFound++;
                            }
                        }
                        batchArr.put(item);
                    } catch (Exception ignored) {
                    }

                    if (batchArr.length() >= batchSize || processed == total) {
                        JSONObject batchPayload = new JSONObject();
                        try {
                            batchPayload.put("items", batchArr);
                            batchPayload.put("processed", processed);
                            batchPayload.put("total", total);
                        } catch (Exception ignored) {
                        }
                        emitJsCallback("__komoNativeFolderBatch", batchPayload);
                        emitFolderStatus(
                            "Importando " + processed + " / " + total + " libros (" + coversFound + " portadas)...",
                            processed,
                            total,
                            coversFound
                        );
                        batchArr = new JSONArray();
                        // Brief pause so WebView IndexedDB commits smoothly on low-RAM devices
                        try {
                            Thread.sleep(25);
                        } catch (InterruptedException ignored) {
                        }
                    }
                }

                JSONObject done = new JSONObject();
                try {
                    done.put("ok", true);
                    done.put("totalFound", allCandidates.size());
                    done.put("totalEmitted", processed);
                    done.put("skippedCount", skippedRef[0]);
                    done.put("rootFolderName", rootFolderName);
                    done.put("treeUri", treeUri.toString());
                } catch (Exception ignored) {
                }
                emitJsCallback("__komoNativeFolderDone", done);
            } catch (Exception e) {
                JSONObject err = new JSONObject();
                try {
                    err.put("ok", false);
                    err.put("error", e.getMessage() != null ? e.getMessage() : "Error al escanear la carpeta");
                } catch (Exception ignored) {
                }
                emitJsCallback("__komoNativeFolderDone", err);
            } finally {
                if (scanTmp.exists()) scanTmp.delete();
            }
        }, "KomoFolderScanner").start();
    }

    private static class KomoAndroidBridge {
        private final MainActivity activity;

        KomoAndroidBridge(MainActivity activity) {
            this.activity = activity;
        }

        private String sanitizeFileName(String raw) {
            String clean = raw == null ? "komolib-backup.json" : raw.replaceAll("[^a-zA-Z0-9._-]", "_");
            return clean.isEmpty() ? "komolib-backup.json" : clean;
        }

        @JavascriptInterface
        public boolean pickLibraryFolder() {
            activity.launchLibraryFolderPicker();
            return true;
        }

        @JavascriptInterface
        public boolean rescanLibraryFolder(String treeUriStr, String skipKeysJson) {
            if (treeUriStr == null || treeUriStr.trim().isEmpty()) return false;
            try {
                Uri treeUri = Uri.parse(treeUriStr.trim());
                Set<String> skipUris = new HashSet<>();
                Set<String> skipNames = new HashSet<>();
                if (skipKeysJson != null && !skipKeysJson.trim().isEmpty()) {
                    JSONObject obj = new JSONObject(skipKeysJson);
                    JSONArray urisArr = obj.optJSONArray("uris");
                    if (urisArr != null) {
                        for (int i = 0; i < urisArr.length(); i++) {
                            String u = urisArr.optString(i, "");
                            if (!u.isEmpty()) skipUris.add(u);
                        }
                    }
                    JSONArray namesArr = obj.optJSONArray("fileNames");
                    if (namesArr != null) {
                        for (int i = 0; i < namesArr.length(); i++) {
                            String n = namesArr.optString(i, "");
                            if (!n.isEmpty()) skipNames.add(n);
                        }
                    }
                }
                activity.processLibraryFolderUri(treeUri, skipUris, skipNames);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public long getNativeUriSize(String uriStr) {
            if (uriStr == null || uriStr.isEmpty()) return -1;
            try {
                Uri uri = Uri.parse(uriStr);
                try (ParcelFileDescriptor pfd = activity.getContentResolver().openFileDescriptor(uri, "r")) {
                    if (pfd != null) {
                        long sz = pfd.getStatSize();
                        if (sz >= 0) return sz;
                    }
                }
            } catch (Exception ignored) {
            }
            return -1;
        }

        @JavascriptInterface
        public String readNativeUriChunk(String uriStr, int chunkIndex) {
            if (uriStr == null || uriStr.isEmpty() || chunkIndex < 0) return "";
            long offset = (long) chunkIndex * BACKUP_CHUNK_BYTES;
            Uri uri = Uri.parse(uriStr);
            try {
                // Fast O(1) random access via FileChannel when supported by Storage Access Framework
                try (ParcelFileDescriptor pfd = activity.getContentResolver().openFileDescriptor(uri, "r")) {
                    if (pfd != null) {
                        try (FileInputStream fis = new FileInputStream(pfd.getFileDescriptor())) {
                            FileChannel ch = fis.getChannel();
                            long fileLen = ch.size();
                            if (fileLen > 0) {
                                if (offset >= fileLen) return "";
                                int toRead = (int) Math.min(BACKUP_CHUNK_BYTES, fileLen - offset);
                                byte[] buf = new byte[toRead];
                                ByteBuffer bb = ByteBuffer.wrap(buf);
                                long pos = offset;
                                while (bb.hasRemaining()) {
                                    int r = ch.read(bb, pos);
                                    if (r <= 0) break;
                                    pos += r;
                                }
                                int actual = bb.position();
                                if (actual <= 0) return "";
                                return Base64.encodeToString(buf, 0, actual, Base64.NO_WRAP);
                            }
                        }
                    }
                } catch (Exception ignored) {
                }

                // Fallback for non-seekable providers: sequential InputStream skip + read
                try (InputStream is = activity.getContentResolver().openInputStream(uri)) {
                    if (is == null) return "";
                    long skipped = 0;
                    byte[] skipBuf = new byte[32768];
                    while (skipped < offset) {
                        long s = is.skip(offset - skipped);
                        if (s > 0) {
                            skipped += s;
                        } else {
                            int r = is.read(skipBuf, 0, (int) Math.min(skipBuf.length, offset - skipped));
                            if (r < 0) return "";
                            skipped += r;
                        }
                    }
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[65536];
                    int remaining = BACKUP_CHUNK_BYTES;
                    while (remaining > 0) {
                        int r = is.read(buf, 0, Math.min(buf.length, remaining));
                        if (r < 0) break;
                        baos.write(buf, 0, r);
                        remaining -= r;
                    }
                    byte[] out = baos.toByteArray();
                    if (out.length == 0) return "";
                    return Base64.encodeToString(out, Base64.NO_WRAP);
                }
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean pickExternalBackup() {
            activity.launchExternalBackupPicker();
            return true;
        }

        @JavascriptInterface
        public String readBackupChunk(int chunkIndex) {
            if (chunkIndex < 0) return "";
            File tempFile = activity.getBackupTempFile();
            if (!tempFile.exists()) return "";
            long offset = (long) chunkIndex * BACKUP_CHUNK_BYTES;
            long len = tempFile.length();
            if (offset >= len) return "";
            int toRead = (int) Math.min(BACKUP_CHUNK_BYTES, len - offset);
            byte[] buf = new byte[toRead];
            try (RandomAccessFile raf = new RandomAccessFile(tempFile, "r")) {
                raf.seek(offset);
                raf.readFully(buf);
                return Base64.encodeToString(buf, Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void clearBackupTemp() {
            File tempFile = activity.getBackupTempFile();
            if (tempFile.exists()) tempFile.delete();
        }

        @JavascriptInterface
        public String saveFile(String fileName, String mimeType, String content) {
            JSONObject result = new JSONObject();
            String safeName = sanitizeFileName(fileName);
            String safeMime = (mimeType == null || mimeType.isEmpty()) ? "application/json" : mimeType;
            byte[] data = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                    values.put(
                        MediaStore.Downloads.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/Komolib"
                    );
                    ContentResolver resolver = activity.getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        throw new Exception("No se pudo crear el archivo en Descargas");
                    }
                    try (OutputStream os = resolver.openOutputStream(uri)) {
                        if (os == null) throw new Exception("No se pudo abrir el archivo de salida");
                        os.write(data);
                        os.flush();
                    }
                    result.put("ok", true);
                    result.put("location", "Descargas/Komolib/" + safeName);
                    result.put("uri", uri.toString());
                    return result.toString();
                } else {
                    File dir = new File(
                        activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                        "Komolib"
                    );
                    if (!dir.exists()) dir.mkdirs();
                    File outFile = new File(dir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(data);
                        fos.flush();
                    }
                    result.put("ok", true);
                    result.put("location", outFile.getAbsolutePath());
                    return result.toString();
                }
            } catch (Exception e) {
                try {
                    result.put("ok", false);
                    result.put("error", e.getMessage() != null ? e.getMessage() : "Error al guardar");
                } catch (Exception ignored) {
                }
                return result.toString();
            }
        }

        @JavascriptInterface
        public boolean shareFile(String fileName, String mimeType, String content) {
            String safeName = sanitizeFileName(fileName);
            String safeMime = (mimeType == null || mimeType.isEmpty()) ? "application/json" : mimeType;
            byte[] data = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
            try {
                File cacheDir = new File(activity.getCacheDir(), "shared_backups");
                if (!cacheDir.exists()) cacheDir.mkdirs();
                File outFile = new File(cacheDir, safeName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(data);
                    fos.flush();
                }
                Uri uri = FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    outFile
                );
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(safeMime);
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.putExtra(Intent.EXTRA_SUBJECT, safeName);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(intent, "Guardar o compartir copia de Komolib");
                activity.runOnUiThread(() -> activity.startActivity(chooser));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean copyText(String text) {
            try {
                activity.runOnUiThread(() -> {
                    ClipboardManager cm =
                        (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        ClipData clip = ClipData.newPlainText("Komolib", text == null ? "" : text);
                        cm.setPrimaryClip(clip);
                    }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean openExternalUrl(String url) {
            if (url == null || url.trim().isEmpty()) return false;
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.runOnUiThread(() -> activity.startActivity(intent));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String consumePendingGoogleAuth() {
            return activity.takePendingGoogleAuthPayload();
        }

        @JavascriptInterface
        public boolean shareText(String title, String text) {
            try {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_SUBJECT, title == null ? "Komolib" : title);
                intent.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                Intent chooser = Intent.createChooser(intent, title == null ? "Compartir con Komolib" : title);
                activity.runOnUiThread(() -> activity.startActivity(chooser));
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }
}
